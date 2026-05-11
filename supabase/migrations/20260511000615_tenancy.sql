-- T-011 · Tenancy schema (consultoras, consultora_members, audit_log) + RLS multi-tenant.
--
-- Contrato multi-tenant que heredan todos los modulos futuros (informes, EPP, calendario,
-- checklists, capacitaciones, permisos, accidentabilidad, documentos, pagos).
--
-- Estrategia RLS: shared DB + isolated rows + custom claim `app_metadata.consultora_id`
-- inyectado por Supabase Auth Hook (T-016). La funcion `current_consultora_id()` lo extrae
-- del JWT. Policies con default-deny: solo SELECT explicito; INSERT/UPDATE/DELETE solo
-- por service-role (signup T-012, mutations futuras) o triggers AFTER (audit_log T-019).
--
-- Naming: ingles (forward convention). M2 + M3 del doc 03 actualizados a este schema;
-- el resto del doc 03 se migra a ingles modulo por modulo (ver nota en doc 03).
--
-- Ver tambien: ADR-0006 (multi-tenant RLS strategy).


-- =============================================================================
-- TABLAS
-- =============================================================================

-- consultoras (tenant root) -----------------------------------------------------
create table public.consultoras (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$' and length(slug) between 3 and 60),
  cuit          text,
  plan_tier     text not null default 'trial'
                check (plan_tier in ('trial', 'pro', 'team', 'enterprise')),
  trial_ends_at timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.consultoras is
  'Tenant root: cada consultora HyS es un tenant aislado por RLS via consultora_id.';
comment on column public.consultoras.slug is
  'Identificador URL-friendly, lowercase + digitos + guiones, 3-60 chars.';
comment on column public.consultoras.cuit is
  'CUIT argentino (sin guiones). Nullable hasta primera facturacion (MP T-029).';
comment on column public.consultoras.plan_tier is
  'trial (7 dias post-signup) | pro (USD 30) | team (USD 100, Fase 2) | enterprise (USD 250, Fase 4).';
comment on column public.consultoras.archived_at is
  'Soft delete. NULL = activa. NOT NULL = archivada (preservamos audit_log via FK on delete restrict).';

create index idx_consultoras_plan_tier on public.consultoras(plan_tier);
create index idx_consultoras_archived on public.consultoras(archived_at) where archived_at is null;


-- consultora_members (auth.users <-> consultoras m2m) ------------------------------
create table public.consultora_members (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  consultora_id uuid not null references public.consultoras(id) on delete cascade,
  role          text not null check (role in ('owner', 'member')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, consultora_id)
);

comment on table public.consultora_members is
  'Membresia user<->consultora con rol. MVP single-tenant per user pero el schema soporta m2m.';
comment on column public.consultora_members.role is
  'owner: control total (cambiar plan, invitar/expulsar). member: acceso operativo.';

create index idx_consultora_members_consultora on public.consultora_members(consultora_id);
-- El UNIQUE (user_id, consultora_id) crea automaticamente un index util para JOIN por user.


-- audit_log (INSERT-only, inmutable) -----------------------------------------------
create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  consultora_id uuid not null references public.consultoras(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action        text not null,
  entity_type   text,
  entity_id     uuid,
  before_data   jsonb,
  after_data    jsonb,
  ip            inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);

comment on table public.audit_log is
  'Bitacora inmutable de eventos por tenant. INSERT-only via triggers AFTER (T-019) o service-role.';
comment on column public.audit_log.actor_user_id is
  'NULL si el actor fue borrado (on delete set null preserva la entrada de log).';
comment on column public.audit_log.action is
  'Verbo en snake_case: created | updated | deleted | login_succeeded | export_generated | ...';
comment on column public.audit_log.before_data is
  'Snapshot pre-cambio (NULL en CREATE). Util para diff semantico.';
comment on column public.audit_log.after_data is
  'Snapshot post-cambio (NULL en DELETE). Util para diff semantico.';

create index idx_audit_log_consultora_created on public.audit_log(consultora_id, created_at desc);
create index idx_audit_log_entity on public.audit_log(entity_type, entity_id) where entity_type is not null;


-- =============================================================================
-- FUNCIONES
-- =============================================================================

-- current_consultora_id: extrae el tenant id del custom claim del JWT.
--
-- - stable: el resultado depende del JWT del request, no cambia durante la query.
-- - security definer + search_path = '': patron Supabase canonico para evitar
--   search-path injection en funciones invocadas desde RLS policies.
-- - Lee de app_metadata (controlado por el server, inyectado por T-016) y NO de
--   user_metadata (modificable por el usuario).
-- - nullif(coalesce(...), '')::uuid: maneja JWT ausente / claim vacio devolviendo
--   NULL en lugar de tirar. Las queries auth-only devuelven 0 rows en ese caso
--   (comportamiento intencional pre-T-016).
create or replace function public.current_consultora_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(
    coalesce(auth.jwt() -> 'app_metadata' ->> 'consultora_id', ''),
    ''
  )::uuid
$$;

comment on function public.current_consultora_id() is
  'Extrae app_metadata.consultora_id del JWT. NULL si no hay claim. Inyectado por Auth Hook (T-016).';


-- set_updated_at: trigger BEFORE UPDATE compartido.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger compartido: setea updated_at = now() en cada UPDATE.';


-- audit_log_immutable: rechaza UPDATE y DELETE del audit_log.
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'audit_log es inmutable: % no permitido', tg_op;
end;
$$;

comment on function public.audit_log_immutable() is
  'Trigger BEFORE UPDATE/DELETE en audit_log: rechaza la operacion. INSERT-only enforced en DB.';


-- =============================================================================
-- TRIGGERS
-- =============================================================================

create trigger set_updated_at_consultoras
  before update on public.consultoras
  for each row execute function public.set_updated_at();

create trigger set_updated_at_consultora_members
  before update on public.consultora_members
  for each row execute function public.set_updated_at();

create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.audit_log_immutable();

create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.audit_log_immutable();


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
--
-- Default-deny: enable RLS + solo SELECT policies. INSERT/UPDATE/DELETE para
-- clientes authenticated/anon estan denegados por omision. service-role bypasa
-- RLS y se usa desde server actions para mutations (signup T-012, etc.).
-- =============================================================================

alter table public.consultoras enable row level security;
alter table public.consultora_members enable row level security;
alter table public.audit_log enable row level security;


-- consultoras: SELECT solo si es la del usuario logueado.
create policy consultoras_select_own on public.consultoras
  for select using (id = public.current_consultora_id());

-- consultoras: UPDATE solo si es la suya Y el user es owner.
create policy consultoras_update_own_owner on public.consultoras
  for update using (
    id = public.current_consultora_id()
    and exists (
      select 1 from public.consultora_members
      where consultora_members.consultora_id = consultoras.id
        and consultora_members.user_id = auth.uid()
        and consultora_members.role = 'owner'
    )
  );


-- consultora_members: SELECT de la propia consultora.
create policy consultora_members_select_own on public.consultora_members
  for select using (consultora_id = public.current_consultora_id());

-- consultora_members: SELECT defensivo del propio row (pre-T-016, sin custom claim).
-- Razon: en signup (T-012) el user no tiene app_metadata.consultora_id hasta que
-- T-016 lo inyecte. El client necesita poder leer su propia membership para decidir
-- el redirect post-signup. PostgreSQL combina policies con OR, asi que esta es
-- complemento (no reemplazo) de consultora_members_select_own.
create policy consultora_members_select_self on public.consultora_members
  for select using (user_id = auth.uid());


-- audit_log: SELECT de la propia consultora (todos los roles ven su log).
create policy audit_log_select_own on public.audit_log
  for select using (consultora_id = public.current_consultora_id());


-- INTENCIONAL: sin policies de INSERT/DELETE en estas tablas.
--   - consultoras INSERT: solo service-role (signup flow T-012).
--   - consultora_members INSERT/UPDATE/DELETE: solo service-role (T-012 / T-014).
--   - audit_log INSERT: solo service-role o triggers AFTER en tablas de dominio
--     (T-019 / T-020). Default-deny para clientes authenticated/anon.
