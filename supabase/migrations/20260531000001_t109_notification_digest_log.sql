-- =============================================================================
-- T-109 · NOTIFICATION DIGEST LOG + CRON WEEKLY SUMMARY (EPP)
-- =============================================================================
-- Tabla de idempotencia para digests periodicos (hoy: resumen semanal EPP).
-- Patron: replica T-074 (billing_notifications_log) -> claim-then-send + UNIQUE.
-- NO es tabla de dominio: append-only infra log, SIN audit trigger (igual que
-- notification_log / billing_notifications_log). Reusa secrets de Vault de T-031.
-- Ver docs/adr/0009-digest-notification-pattern.md.
-- =============================================================================

-- 1. Tabla
create table public.notification_digest_log (
  id              uuid primary key default gen_random_uuid(),
  consultora_id   uuid not null references public.consultoras(id) on delete cascade,
  tipo            text not null check (tipo in ('epp_weekly_summary')),
  periodo_iso     text not null check (periodo_iso ~ '^\d{4}-W\d{2}$'),  -- '2026-W22'
  channel         text not null check (channel in ('email')),            -- email-only (T-109); telegram/push = T-109-FU
  sent_at         timestamptz not null default now(),
  resend_email_id text,
  created_at      timestamptz not null default now()
);

-- UNIQUE de idempotencia: 1 envio por (consultora, tipo, semana, canal). Las 4
-- columnas son NOT NULL -> no necesita NULLS NOT DISTINCT (a diferencia de T-074,
-- donde ref_id era nullable).
create unique index uniq_notification_digest_consultora_tipo_periodo_channel
  on public.notification_digest_log (consultora_id, tipo, periodo_iso, channel);

create index idx_notification_digest_consultora_sent
  on public.notification_digest_log (consultora_id, sent_at desc);

comment on table public.notification_digest_log is
  'T-109: log de digests periodicos enviados (resumen semanal EPP). UNIQUE '
  '(consultora_id, tipo, periodo_iso, channel) garantiza idempotency. Infra log '
  'append-only, sin audit trigger. Ver ADR-0009.';

-- 2. RLS: SELECT members (audit/debug). Mutations solo service_role (sin policy
-- explicita: las inserts vienen del cron route con service role key, bypass RLS).
alter table public.notification_digest_log enable row level security;

create policy "members_select_notification_digest_log"
  on public.notification_digest_log for select to authenticated
  using (public.is_member_of_consultora(consultora_id));

-- 3. Funcion pg_cron wrapper. POST async al endpoint /api/cron/weekly-summary.
-- Reusa cron_dispatch_secret + cron_dispatch_base_url (Vault, desde T-031).
create or replace function public.process_epp_weekly_summary()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret     text;
  v_base_url   text;
  v_endpoint   text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_dispatch_secret';
  select decrypted_secret into v_base_url
    from vault.decrypted_secrets where name = 'cron_dispatch_base_url';

  -- Placeholder check ROBUSTO (lesson T-031): el equality exacto a
  -- 'REPLACE_ME_POST_DEPLOY' NO captura typos de mayuscula y nos quemo. Chequeamos
  -- prefijo + longitud esperada del secret real (64 chars).
  if v_secret is null or v_secret like 'REPLACE_ME%' or length(v_secret) != 64 then
    raise notice 'process_epp_weekly_summary: cron_dispatch_secret no configurado/placeholder, skip tick';
    return;
  end if;
  if v_base_url is null then
    raise notice 'process_epp_weekly_summary: cron_dispatch_base_url no configurado, skip tick';
    return;
  end if;

  v_endpoint := v_base_url || '/api/cron/weekly-summary';

  -- POST async (pg_net no espera response). El handler arma el resumen por
  -- consultora + envia + loguea en notification_digest_log. Sin body (el handler
  -- decide el periodo ISO server-side con now()).
  select net.http_post(
    url     := v_endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Cron-Secret', v_secret
    ),
    body    := '{}'::jsonb
  ) into v_request_id;
end;
$$;

comment on function public.process_epp_weekly_summary() is
  $c$T-109: dispara POST /api/cron/weekly-summary via pg_net. Lunes 09:00 ART. SECURITY DEFINER + search_path=''.$c$;

-- Seguridad por defecto: la funcion es security definer y lee Vault. NO debe ser
-- ejecutable por usuarios logueados (podrian disparar el cron fuera de horario).
-- pg_cron corre como postgres (owner), no se ve afectado por este revoke.
revoke execute on function public.process_epp_weekly_summary() from public, authenticated;

-- 4. Schedule: '0 12 * * 1' = lunes 12:00 UTC = lunes 09:00 ART (AR es UTC-3 todo
-- el ano, sin DST). day-of-week=1 = lunes. cron.schedule upserta por jobname.
select cron.schedule(
  'process-epp-weekly-summary',
  '0 12 * * 1',
  $cron$select public.process_epp_weekly_summary()$cron$
);
