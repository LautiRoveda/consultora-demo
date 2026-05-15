-- T-031 · Infraestructura de notificaciones: cron + dispatcher + canal email.
--
-- Sprint 3 ticket que cierra la capa de envio de recordatorios del modulo
-- Calendario. T-027 dejo el schema base de eventos y reminders, T-028 las
-- server actions, T-029/T-030 la UI. Hasta aca el modulo MUESTRA los
-- vencimientos pero no envia un solo email. Este archivo agrega:
--
--   1. Extension pg_net (HTTP requests desde Postgres).
--   2. Tabla notification_channel_prefs (preferencias por user+channel).
--   3. Trigger AFTER INSERT en consultora_members que crea row default
--      email-enabled. Backfill incluido para members ya existentes.
--   4. Tabla notification_log (bitacora inmutable de envios).
--   5. Secrets de Vault con NAME predecibles (cron_dispatch_secret +
--      cron_dispatch_base_url). Valores placeholder, Lautaro reemplaza
--      post-deploy via Studio UI.
--   6. Funcion SQL process_pending_reminders() (security definer) con
--      SELECT FOR UPDATE SKIP LOCKED + UPDATE 'sent' en misma TX +
--      net.http_post async hacia el endpoint dispatcher.
--   7. cron.schedule cada 5 minutos.
--
-- Idempotency en cascada (discovery seccion 7.4):
--   Capa 1: UNIQUE (event_id, offset_days) ya esta en T-027.
--   Capa 2: UPDATE status='sent' ANTES del net.http_post (claim layer).
--   Capa 3: el endpoint chequea notification_log antes de emitir por canal.
--   Capa 4: el sender pasa reminder_id como idempotency_key a Resend.
--
-- At-most-once delivery: si el HTTP POST falla, NO se reintenta. El
-- reminder queda con status='sent' (capa 2) + notification_log con
-- status='failed' + Sentry. Aceptable porque notification != critical path.
--
-- Drift resuelto vs discovery seccion 7.3:
--   - Discovery usa current_setting('app.cron_secret'); aca usamos Vault
--     porque es mas robusto (rotation in-place via Studio sin migration).
--   - Discovery menciona cliente_id/empleado_id en el JOIN; esas columnas
--     no existen aun en calendar_events (T-027). Removidas del SELECT.

-- =============================================================================
-- 1. EXTENSION pg_net
-- =============================================================================

create extension if not exists "pg_net" with schema extensions;

comment on extension "pg_net" is
  'HTTP requests async desde Postgres. T-031: cron dispara POST al dispatcher.';

-- =============================================================================
-- 2. TABLA notification_channel_prefs
-- =============================================================================
--
-- Preferencias por user x channel. Decisiones:
--   - Single source of truth (DA-03): un row por (user_id, channel).
--   - muted_until: mute temporal (discovery EC-09). NULL = no muted.
--   - enabled: toggle hard (discovery EC-08). false = no envies nunca por
--     este canal hasta que el user vuelva a tildarlo.
--   - DELETE sin policy: el toggle disable es UPDATE enabled=false. Hard
--     delete solo cuando T-035 lo necesite.

create table public.notification_channel_prefs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  channel      text not null check (channel in ('email', 'telegram', 'push')),
  enabled      boolean not null default true,
  muted_until  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, channel)
);

comment on table public.notification_channel_prefs is
  $c$T-031: preferencias de canal por user. 1 row por (user, channel). UI de edicion vive en T-035 (settings de notificaciones).$c$;
comment on column public.notification_channel_prefs.muted_until is
  $c$Mute temporal hasta esta fecha. NULL = sin mute. discovery EC-09.$c$;
comment on column public.notification_channel_prefs.enabled is
  $c$Toggle hard. false = no envies por este canal. discovery EC-08.$c$;

create index idx_ncp_user_enabled
  on public.notification_channel_prefs(user_id)
  where enabled = true;

create trigger set_updated_at_notification_channel_prefs
  before update on public.notification_channel_prefs
  for each row execute function public.set_updated_at();

-- RLS: cada user ve y edita SOLO sus propias prefs. Service-role bypasa
-- (lo usan el dispatcher T-031 y futuros T-035).

alter table public.notification_channel_prefs enable row level security;

create policy ncp_select_own on public.notification_channel_prefs
  for select using (user_id = auth.uid());

create policy ncp_insert_own on public.notification_channel_prefs
  for insert with check (user_id = auth.uid());

create policy ncp_update_own on public.notification_channel_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- DELETE: sin policy para authenticated (default-deny).

-- =============================================================================
-- 3. TRIGGER ensure_default_email_pref (AFTER INSERT en consultora_members)
-- =============================================================================
--
-- Cuando un user nuevo entra a una consultora (signup T-012 o invite
-- futuro), automaticamente le creamos una row 'email' enabled=true.
-- Idempotente: ON CONFLICT DO NOTHING para users que ya entraron a otra
-- consultora antes (MVP single-tenant pero schema soporta m2m).

create or replace function public.ensure_default_email_pref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_channel_prefs (user_id, channel, enabled)
  values (new.user_id, 'email', true)
  on conflict (user_id, channel) do nothing;
  return new;
end;
$$;

comment on function public.ensure_default_email_pref() is
  $c$T-031: AFTER INSERT en consultora_members crea row default email-enabled. Idempotente via ON CONFLICT DO NOTHING.$c$;

create trigger ensure_default_email_pref_after_member_insert
  after insert on public.consultora_members
  for each row execute function public.ensure_default_email_pref();

-- Backfill: insertar email-enabled retroactivo para members ya existentes.
-- DISTINCT porque el schema soporta m2m (un user en N consultoras = 1
-- row de prefs, no N).

insert into public.notification_channel_prefs (user_id, channel, enabled)
select distinct user_id, 'email', true
from public.consultora_members
on conflict (user_id, channel) do nothing;

-- =============================================================================
-- 4. TABLA notification_log
-- =============================================================================
--
-- Bitacora inmutable de envios. Misma filosofia que audit_log (T-011):
-- INSERT-only via service-role (no via authenticated), triggers BEFORE
-- UPDATE/DELETE que rechazan la operacion.
--
-- consultora_id: FK on delete restrict porque queremos preservar el log
-- aunque la consultora se borre (compliance + analitica historica).
--
-- reminder_id / event_id: nullable FK on delete set null. Si el reminder
-- o el event se borran (cascade desde consultora_id), el log queda
-- huerfano pero conserva la informacion del envio.
--
-- channel: 'email' | 'telegram' | 'push'. CHECK enforce.
-- status: 'sent' | 'skipped' | 'failed' | 'bounced'. 'bounced' lo usa
-- el webhook de Resend (T-031-FU si vale).

create table public.notification_log (
  id                  uuid primary key default gen_random_uuid(),
  consultora_id       uuid not null references public.consultoras(id) on delete restrict,
  reminder_id         uuid references public.calendar_event_reminders(id) on delete set null,
  event_id            uuid references public.calendar_events(id) on delete set null,
  recipient_user_id   uuid references auth.users(id) on delete set null,
  channel             text not null check (channel in ('email', 'telegram', 'push')),
  status              text not null check (status in ('sent', 'skipped', 'failed', 'bounced')),
  provider_message_id text,
  error_code          text,
  error_detail        text,
  sent_at             timestamptz not null default now()
);

comment on table public.notification_log is
  $c$T-031: bitacora inmutable de envios. INSERT-only via service-role. Triggers rechazan UPDATE y DELETE (replica patron audit_log T-011).$c$;
comment on column public.notification_log.provider_message_id is
  $c$Resend message id (rsd_*) si status=sent. NULL si skipped o failed.$c$;
comment on column public.notification_log.error_code is
  $c$Codigo estable para analitica: EVENT_NOT_PENDING | NO_RECIPIENT | NO_RECIPIENT_EMAIL | DISABLED | MUTED | ALREADY_SENT | RESEND_* | NO_CHANNEL_IMPL_T033 | NO_CHANNEL_IMPL_T034.$c$;
comment on column public.notification_log.error_detail is
  $c$Mensaje libre para debug. NO incluir contenido del email (PII Ley 25.326).$c$;

create index idx_notif_log_consultora_sent
  on public.notification_log(consultora_id, sent_at desc);

-- Index para idempotency check del dispatcher (capa 3).
create index idx_notif_log_idempotency
  on public.notification_log(reminder_id, channel, status)
  where reminder_id is not null;

-- Inmutabilidad: replica exacto patron audit_log T-011.

create or replace function public.notification_log_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'notification_log es inmutable: % no permitido', tg_op;
end;
$$;

comment on function public.notification_log_immutable() is
  $c$Trigger BEFORE UPDATE/DELETE en notification_log: rechaza la operacion. INSERT-only enforced en DB.$c$;

create trigger notification_log_no_update
  before update on public.notification_log
  for each row execute function public.notification_log_immutable();

create trigger notification_log_no_delete
  before delete on public.notification_log
  for each row execute function public.notification_log_immutable();

-- RLS: SELECT cross-tenant denied. INSERT/UPDATE/DELETE sin policy
-- para authenticated -> service-role only.

alter table public.notification_log enable row level security;

create policy notification_log_select_own on public.notification_log
  for select using (public.is_member_of_consultora(consultora_id));

-- =============================================================================
-- 5. VAULT: secrets con NAME predecibles
-- =============================================================================
--
-- La funcion SQL process_pending_reminders() lee por NAME (no por UUID
-- auto-generado por vault.create_secret) para estabilidad cross-env.
--
-- Placeholders: la migration carga 'REPLACE_ME_POST_DEPLOY' y la URL del
-- VPS productivo como defaults. Lautaro reemplaza el secret real via
-- Studio UI -> Vault -> edit. La funcion SQL detecta el placeholder y
-- retorna early con 'raise notice' (no llamar al endpoint con header
-- bullshit ni alertar Sentry hasta que este configurado).
--
-- IMPORTANTE: vault.create_secret falla si el name ya existe. La funcion
-- DO block detecta la duplicidad y skipea (caso: re-aplicar migration en
-- el mismo proyecto despues de rollback). Esto NO es idempotencia 100%
-- pero permite re-correr la migration en el mismo proyecto sin error.

do $$
begin
  -- cron_dispatch_secret
  if not exists (select 1 from vault.secrets where name = 'cron_dispatch_secret') then
    perform vault.create_secret(
      'REPLACE_ME_POST_DEPLOY',
      'cron_dispatch_secret',
      $c$T-031: shared secret entre pg_cron y POST /api/calendar/dispatch-reminder. Mismo valor que INTERNAL_CRON_SECRET en env vars del service Next.js. Rotacion: Studio -> Vault -> edit secret. Generar con openssl rand -hex 32.$c$
    );
  end if;

  -- cron_dispatch_base_url
  if not exists (select 1 from vault.secrets where name = 'cron_dispatch_base_url') then
    perform vault.create_secret(
      'https://consultora-demo.test-ia.cloud',
      'cron_dispatch_base_url',
      $c$T-031: base URL del endpoint receptor del cron. Editable para staging/preview futuros.$c$
    );
  end if;
end $$;

-- =============================================================================
-- 6. FUNCION process_pending_reminders()
-- =============================================================================
--
-- Claim layer (capa 2 del idempotency stack):
--   - SELECT FOR UPDATE SKIP LOCKED filtra reminders pending due cuyo
--     event sigue siendo pending (skip cancelled/completed).
--   - UPDATE status='sent' en misma TX antes del net.http_post.
--   - net.http_post es async (pg_net no espera response). Si el endpoint
--     tarda 10s, esta funcion ya retorno; el response queda en
--     net._http_response (lifecycle 6h, fuera del scope T-031).
--
-- Limit 100/tick: 5min * 12 ticks/h * 100 = 28k/dia. Sobra MVP.
--
-- Retorna SETOF (claimed_id uuid, dispatched boolean) para visibilidad
-- debug desde Studio. Vacio cuando nada pending.

create or replace function public.process_pending_reminders()
returns table (claimed_id uuid, dispatched boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret     text;
  v_base_url   text;
  v_endpoint   text;
  r            record;
  v_request_id bigint;
begin
  -- Lee secrets de Vault por NAME estable.
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_dispatch_secret';
  select decrypted_secret into v_base_url
    from vault.decrypted_secrets where name = 'cron_dispatch_base_url';

  -- Defensa: placeholder no reemplazado -> skip tick silencioso.
  -- No raise exception (el cron seguiria intentando); raise notice queda
  -- en logs Postgres sin alertar Sentry hasta config completa.
  if v_secret is null or v_secret = 'REPLACE_ME_POST_DEPLOY' then
    raise notice 'process_pending_reminders: cron_dispatch_secret no configurado, skip tick';
    return;
  end if;
  if v_base_url is null then
    raise notice 'process_pending_reminders: cron_dispatch_base_url no configurado, skip tick';
    return;
  end if;

  v_endpoint := v_base_url || '/api/calendar/dispatch-reminder';

  -- Claim + dispatch.
  for r in
    select cer.id
      from public.calendar_event_reminders cer
      join public.calendar_events ce on ce.id = cer.event_id
     where cer.status = 'pending'
       and cer.scheduled_at <= now()
       and ce.status = 'pending'
     order by cer.scheduled_at
     limit 100
     for update of cer skip locked
  loop
    -- Marca sent ANTES del HTTP (at-most-once). Si el HTTP falla, el
    -- reminder queda sent + notification_log con failed + Sentry.
    update public.calendar_event_reminders
       set status = 'sent', sent_at = now()
     where id = r.id;

    -- HTTP async (no espera response).
    select net.http_post(
      url     := v_endpoint,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Internal-Cron-Secret', v_secret
      ),
      body    := jsonb_build_object('reminder_id', r.id::text)
    ) into v_request_id;

    claimed_id := r.id;
    dispatched := true;
    return next;
  end loop;
end;
$$;

comment on function public.process_pending_reminders() is
  $c$T-031: claim reminders due + POST async via pg_net al dispatcher. At-most-once delivery. Limit 100/tick. SECURITY DEFINER + search_path=''.$c$;

-- =============================================================================
-- 7. CRON SCHEDULE
-- =============================================================================
--
-- discovery 7.2 cerro frecuencia */5 (sweet spot carga vs jitter UX).
-- Si en T-031-FU2 hace falta digest diario, ajustar a horario fijo
-- (ej '0 9 * * *' para 09:00 ART).

select cron.schedule(
  'process-pending-reminders',
  '*/5 * * * *',
  $cron$select public.process_pending_reminders()$cron$
);

-- =============================================================================
-- GRANTS
-- =============================================================================
--
-- vault.decrypted_secrets requiere grant en algunos proyectos. Defensa
-- explicita para que la funcion no falle al leer secrets desde el cron
-- (security definer corre como owner postgres).

grant usage on schema vault to postgres;
grant select on vault.decrypted_secrets to postgres;

-- pg_net schema. La funcion process_pending_reminders (security definer)
-- corre como postgres y necesita acceso a net.http_post.

grant usage on schema net to postgres;
grant execute on all functions in schema net to postgres;
