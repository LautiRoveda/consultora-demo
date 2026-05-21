-- T-070 · Pagos schema + rename legacy plan_tier/trial_ends_at a español.
--
-- DB-only: schema completo del módulo Pagos (suscripciones + facturas) + rename
-- atómico de los dos campos legacy en consultoras a nomenclatura española.
-- Cero server actions, cero UI, cero MP integration (eso es T-071/T-072).
--
-- Cambios:
--   1. consultoras.plan_tier → plan (text, mismo CHECK + default).
--   2. consultoras.trial_ends_at → trial_hasta (timestamptz).
--   3. consultoras.retencion_datos_hasta (nuevo, timestamptz nullable) — Ley 25.326.
--   4. Re-emisión de create_consultora_and_owner() con los nombres nuevos en el
--      INSERT — atomicidad de rename (la app sigue compilando post-push).
--   5. Enums plan_codigo / estado_suscripcion / estado_factura.
--   6. Tabla suscripciones (UNIQUE parcial: una activa por consultora).
--   7. Tabla facturas (mp_payment_id UNIQUE = idempotencia de webhooks MP).
--   8. RLS read-only para authenticated via helpers T-015; mutaciones solo
--      service_role (webhooks MP en T-071). Default-deny.
--   9. Audit triggers AFTER (patrón audit_clientes T-047 + diff guard).
--
-- Ver también: docs/adr/0008-pagos-mercadopago-subscriptions.md.


-- =============================================================================
-- 1. RENAME + ADD en consultoras
-- =============================================================================

alter table public.consultoras rename column plan_tier to plan;
alter table public.consultoras rename column trial_ends_at to trial_hasta;
alter index public.idx_consultoras_plan_tier rename to idx_consultoras_plan;

alter table public.consultoras
  add column retencion_datos_hasta timestamptz;

comment on column public.consultoras.plan is
  'trial (7 dias post-signup) | pro (USD 30) | team (USD 100, Fase 2) | enterprise (USD 250, Fase 4). Denormalizado desde suscripciones.plan_codigo via webhook MP (T-071), usado por gates UI sin join.';
comment on column public.consultoras.trial_hasta is
  'Fin del trial 7d post-signup. NULL una vez que la consultora migra a plan pago.';
comment on column public.consultoras.retencion_datos_hasta is
  'Set al cancelar/expirar suscripcion: now() + 30d. Cron futuro deletea cuando alcanza esta fecha (Ley 25.326).';


-- =============================================================================
-- 2. Re-emisión create_consultora_and_owner con nombres nuevos
-- =============================================================================
--
-- Body VERBATIM de 20260511004933_signup_function.sql. Único cambio: línea del
-- INSERT en consultoras usa los nombres nuevos (plan / trial_hasta). NO refactor
-- adicional — rename atómico para que la app no se rompa entre push y deploy.

create or replace function public.create_consultora_and_owner(
  p_user_id uuid,
  p_name    text
)
returns table (consultora_id uuid, slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug_base      text;
  v_slug_candidate text;
  v_suffix         text;
  v_consultora_id  uuid;
  v_attempts       int := 0;
begin
  -- Normalizacion del slug base (sin sufijo).
  v_slug_base := lower(public.unaccent(p_name));
  v_slug_base := regexp_replace(v_slug_base, '[^a-z0-9]+', '-', 'g');
  v_slug_base := regexp_replace(v_slug_base, '^-+|-+$', '', 'g');
  if length(v_slug_base) < 1 then
    v_slug_base := 'consultora';
  end if;
  -- Truncar a 55 chars para dar margen al sufijo '-XXXX' (5 chars) -> total 60,
  -- que matchea el CHECK length(slug) <= 60 en public.consultoras.
  v_slug_base := substr(v_slug_base, 1, 55);

  -- Loop con retry por colision.
  loop
    v_attempts := v_attempts + 1;
    v_suffix := substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    v_slug_candidate := v_slug_base || '-' || v_suffix;
    begin
      insert into public.consultoras (name, slug, plan, trial_hasta)
      values (p_name, v_slug_candidate, 'trial', now() + interval '7 days')
      returning id into v_consultora_id;
      exit;  -- success: salimos del loop
    exception when unique_violation then
      if v_attempts >= 5 then
        raise exception 'No se pudo generar slug unico para %', p_name
          using errcode = 'unique_violation';
      end if;
      -- continue loop: probamos otro sufijo
    end;
  end loop;

  -- Membership del creador como owner.
  insert into public.consultora_members (user_id, consultora_id, role)
  values (p_user_id, v_consultora_id, 'owner');

  return query select v_consultora_id, v_slug_candidate;
end;
$$;


-- =============================================================================
-- 3. ENUMS
-- =============================================================================
--
-- plan_codigo: SKU específico de producto MP. Diverge de consultoras.plan (text
-- check, denormalized cache para UI gates). Ver ADR-0008 sección "naming".

create type public.plan_codigo as enum ('pro_mensual');

create type public.estado_suscripcion as enum (
  'trial',      -- pre-pago, 7d post-signup
  'activa',     -- pagando OK
  'morosa',     -- intento de pago fallido reciente, MP reintentando
  'cancelada',  -- user pidió + MP confirmó
  'expirada'    -- trial vencido sin migrar a pago
);

create type public.estado_factura as enum (
  'pendiente',    -- creada, esperando confirmacion MP
  'pagada',
  'fallida',      -- intento fallido (MP retry o user cambia metodo)
  'reembolsada'
);


-- =============================================================================
-- 4. TABLA suscripciones
-- =============================================================================

create table public.suscripciones (
  id                  uuid primary key default gen_random_uuid(),
  consultora_id       uuid not null references public.consultoras(id) on delete cascade,
  plan_codigo         public.plan_codigo not null,
  estado              public.estado_suscripcion not null default 'trial',
  mp_subscription_id  text unique,
  periodo_inicio      timestamptz not null,
  periodo_fin         timestamptz not null,
  cancelar_en         timestamptz,
  cancelada_en        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.suscripciones is
  'Suscripciones a plan pago via Mercado Pago Subscriptions API. Una activa por consultora a la vez (UNIQUE parcial). Las canceladas/expiradas conviven históricas.';
comment on column public.suscripciones.estado is
  'trial (pre-pago) | activa (pagando) | morosa (intento fallido reciente) | cancelada (user pidio + confirmado MP) | expirada (trial vencido sin pago).';
comment on column public.suscripciones.cancelar_en is
  'Set cuando user pide cancelacion. Suscripcion sigue activa hasta esta fecha (fin del periodo pago). NULL = no cancelacion pendiente.';
comment on column public.suscripciones.cancelada_en is
  'Set cuando MP confirma cancelacion via webhook. NULL hasta entonces.';
comment on column public.suscripciones.mp_subscription_id is
  'preapproval_id de Mercado Pago Subscriptions API. NULL durante trial (no hay preapproval todavia).';

-- UNIQUE parcial: una sola suscripción "viva" por consultora. Las cancelled/expired
-- conviven históricas (no entran al filtro WHERE).
create unique index uniq_suscripciones_consultora_activa
  on public.suscripciones (consultora_id)
  where estado in ('trial', 'activa', 'morosa');

create index idx_suscripciones_consultora_estado
  on public.suscripciones (consultora_id, estado);

create index idx_suscripciones_mp_subscription_id
  on public.suscripciones (mp_subscription_id)
  where mp_subscription_id is not null;

create trigger set_updated_at_suscripciones
  before update on public.suscripciones
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 5. TABLA facturas
-- =============================================================================

create table public.facturas (
  id              uuid primary key default gen_random_uuid(),
  consultora_id   uuid not null references public.consultoras(id) on delete cascade,
  suscripcion_id  uuid not null references public.suscripciones(id) on delete restrict,
  monto_centavos  integer not null check (monto_centavos > 0),
  moneda          text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  estado          public.estado_factura not null default 'pendiente',
  mp_payment_id   text unique not null,
  recibo_url      text,
  pagada_en       timestamptz,
  razon_falla     text,
  created_at      timestamptz not null default now()
);

comment on table public.facturas is
  'Facturas/recibos generados a partir de eventos de pago MP. UNIQUE (mp_payment_id) garantiza idempotencia de webhooks (T-071). Sin updated_at: las facturas no se editan, solo se transicionan de estado (igual entra al diff guard del audit).';
comment on column public.facturas.estado is
  'pendiente (creada, esperando confirmacion MP) | pagada | fallida (intento fallado, MP retry o user cambia metodo) | reembolsada.';
comment on column public.facturas.mp_payment_id is
  'payment.id de MP. UNIQUE — un evento de pago MP = una factura (idempotencia de webhooks).';
comment on column public.facturas.recibo_url is
  'Set en estado=pagada con link a comprobante MP (transaction_details.external_resource_url).';
comment on column public.facturas.pagada_en is
  'Timestamp de confirmacion de pago via webhook. NULL hasta entonces.';
comment on column public.facturas.razon_falla is
  'Free-form, copiado del status_detail de MP en eventos failed. Util para support.';

create index idx_facturas_consultora_created
  on public.facturas (consultora_id, created_at desc);
create index idx_facturas_suscripcion
  on public.facturas (suscripcion_id);


-- =============================================================================
-- 6. AUDIT TRIGGERS (patrón audit_clientes T-047)
-- =============================================================================

-- Audit suscripciones --------------------------------------------------------
create or replace function public.audit_suscripciones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_payload jsonb;
  v_after_payload jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (new.consultora_id, auth.uid(), 'created', 'suscripciones', new.id,
       null,
       jsonb_build_object(
         'plan_codigo', new.plan_codigo,
         'estado', new.estado,
         'mp_subscription_id', new.mp_subscription_id,
         'periodo_inicio', new.periodo_inicio,
         'periodo_fin', new.periodo_fin,
         'cancelar_en', new.cancelar_en,
         'cancelada_en', new.cancelada_en
       ));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.plan_codigo, new.estado, new.mp_subscription_id, new.periodo_inicio,
        new.periodo_fin, new.cancelar_en, new.cancelada_en)
       is distinct from
       (old.plan_codigo, old.estado, old.mp_subscription_id, old.periodo_inicio,
        old.periodo_fin, old.cancelar_en, old.cancelada_en) then
      v_before_payload := jsonb_build_object(
        'plan_codigo', old.plan_codigo,
        'estado', old.estado,
        'mp_subscription_id', old.mp_subscription_id,
        'periodo_inicio', old.periodo_inicio,
        'periodo_fin', old.periodo_fin,
        'cancelar_en', old.cancelar_en,
        'cancelada_en', old.cancelada_en
      );
      v_after_payload := jsonb_build_object(
        'plan_codigo', new.plan_codigo,
        'estado', new.estado,
        'mp_subscription_id', new.mp_subscription_id,
        'periodo_inicio', new.periodo_inicio,
        'periodo_fin', new.periodo_fin,
        'cancelar_en', new.cancelar_en,
        'cancelada_en', new.cancelada_en
      );
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'suscripciones', new.id,
         v_before_payload, v_after_payload);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'suscripciones', old.id,
       jsonb_build_object(
         'plan_codigo', old.plan_codigo,
         'estado', old.estado,
         'mp_subscription_id', old.mp_subscription_id
       ),
       null);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_suscripciones() is
  'T-070: trigger AFTER que escribe a audit_log en INSERT/UPDATE/DELETE de suscripciones. Diff guard sobre 7 fields mutables. Payload UPDATE incluye snapshot before/after completo.';

create trigger audit_suscripciones_after_insert
  after insert on public.suscripciones
  for each row execute function public.audit_suscripciones();

create trigger audit_suscripciones_after_update
  after update on public.suscripciones
  for each row execute function public.audit_suscripciones();

create trigger audit_suscripciones_after_delete
  after delete on public.suscripciones
  for each row execute function public.audit_suscripciones();


-- Audit facturas -------------------------------------------------------------
-- Diff guard solo sobre los 4 campos mutables (estado, recibo_url, pagada_en,
-- razon_falla). monto_centavos / moneda / mp_payment_id son inmutables
-- post-creación pero los incluimos en el payload INSERT/DELETE para trazabilidad.
create or replace function public.audit_facturas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_payload jsonb;
  v_after_payload jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (new.consultora_id, auth.uid(), 'created', 'facturas', new.id,
       null,
       jsonb_build_object(
         'suscripcion_id', new.suscripcion_id,
         'monto_centavos', new.monto_centavos,
         'moneda', new.moneda,
         'estado', new.estado,
         'mp_payment_id', new.mp_payment_id
       ));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.estado, new.recibo_url, new.pagada_en, new.razon_falla)
       is distinct from
       (old.estado, old.recibo_url, old.pagada_en, old.razon_falla) then
      v_before_payload := jsonb_build_object(
        'estado', old.estado,
        'recibo_url', old.recibo_url,
        'pagada_en', old.pagada_en,
        'razon_falla', old.razon_falla
      );
      v_after_payload := jsonb_build_object(
        'estado', new.estado,
        'recibo_url', new.recibo_url,
        'pagada_en', new.pagada_en,
        'razon_falla', new.razon_falla
      );
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'facturas', new.id,
         v_before_payload, v_after_payload);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'facturas', old.id,
       jsonb_build_object(
         'mp_payment_id', old.mp_payment_id,
         'monto_centavos', old.monto_centavos,
         'estado', old.estado
       ),
       null);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_facturas() is
  'T-070: trigger AFTER que escribe a audit_log en INSERT/UPDATE/DELETE de facturas. Diff guard sobre 4 fields mutables (estado, recibo_url, pagada_en, razon_falla); monto/moneda/mp_payment_id inmutables.';

create trigger audit_facturas_after_insert
  after insert on public.facturas
  for each row execute function public.audit_facturas();

create trigger audit_facturas_after_update
  after update on public.facturas
  for each row execute function public.audit_facturas();

create trigger audit_facturas_after_delete
  after delete on public.facturas
  for each row execute function public.audit_facturas();


-- =============================================================================
-- 7. RLS
-- =============================================================================
--
-- Default-deny: solo SELECT para members (via helper T-015). INSERT/UPDATE/DELETE
-- exclusivos de service_role (webhook MP en T-071). No hay flujo de mutación
-- directa desde el cliente — todo pasa por Mercado Pago.

alter table public.suscripciones enable row level security;
alter table public.facturas enable row level security;

create policy "members_select_suscripciones"
  on public.suscripciones for select to authenticated
  using (public.is_member_of_consultora(consultora_id));

create policy "members_select_facturas"
  on public.facturas for select to authenticated
  using (public.is_member_of_consultora(consultora_id));
