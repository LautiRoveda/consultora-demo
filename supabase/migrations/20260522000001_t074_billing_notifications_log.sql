-- =============================================================================
-- T-074 · BILLING NOTIFICATIONS LOG + CRON DUNNING
-- =============================================================================
--
-- Tabla idempotente para tracking de emails dunning (trial expires/expired,
-- payment failed, subscription cancelled). UNIQUE compuesto con
-- NULLS NOT DISTINCT permite que trial_* (ref_id null) y payment_failed /
-- subscription_cancelled (ref_id = mp_payment_id | mp_subscription_id)
-- compartan el mismo constraint.
--
-- Pattern: replica T-031 (process_pending_reminders + cron + vault).
-- Reutiliza secrets ya existentes: cron_dispatch_secret + cron_dispatch_base_url.
-- =============================================================================

-- 1. Tabla billing_notifications_log
create table public.billing_notifications_log (
  id              uuid primary key default gen_random_uuid(),
  consultora_id   uuid not null references public.consultoras(id) on delete cascade,
  tipo            text not null check (tipo in (
    'trial_expires_in_3d',
    'trial_expires_in_1d',
    'trial_expired',
    'payment_failed',
    'subscription_cancelled'
  )),
  ref_id          text,
  sent_at         timestamptz not null default now(),
  resend_email_id text,
  created_at      timestamptz not null default now()
);

-- UNIQUE compuesto con NULLS NOT DISTINCT (Postgres 15+). Para trial_*
-- ref_id es null y aun asi el constraint dispara conflict en re-envios.
create unique index uniq_billing_notif_consultora_tipo_ref
  on public.billing_notifications_log (consultora_id, tipo, ref_id)
  nulls not distinct;

create index idx_billing_notif_consultora_sent
  on public.billing_notifications_log (consultora_id, sent_at desc);

comment on table public.billing_notifications_log is
  'T-074: log de emails dunning enviados. UNIQUE compuesto (NULLS NOT DISTINCT) garantiza idempotency.';

-- 2. RLS: SELECT members (audit/debug). Mutations solo service_role (sin
-- policy explicita: las inserts vienen de los Server Actions / webhook
-- corriendo con service role key, que bypass RLS).
alter table public.billing_notifications_log enable row level security;

create policy "members_select_billing_notifications_log"
  on public.billing_notifications_log for select to authenticated
  using (public.is_member_of_consultora(consultora_id));

-- 3. Funcion pg_cron wrapper. POST async al endpoint /api/cron/billing-notifications.
-- Reutiliza cron_dispatch_secret + cron_dispatch_base_url ya en Vault desde T-031.
create or replace function public.process_pending_billing_dunning()
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

  if v_secret is null or v_secret = 'REPLACE_ME_POST_DEPLOY' then
    raise notice 'process_pending_billing_dunning: cron_dispatch_secret no configurado, skip tick';
    return;
  end if;
  if v_base_url is null then
    raise notice 'process_pending_billing_dunning: cron_dispatch_base_url no configurado, skip tick';
    return;
  end if;

  v_endpoint := v_base_url || '/api/cron/billing-notifications';

  -- POST async (pg_net no espera response). El handler hace queries +
  -- envios + log inserts. No body necesario (handler decide buckets
  -- en base a now() server-side).
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

comment on function public.process_pending_billing_dunning() is
  $c$T-074: dispara POST /api/cron/billing-notifications via pg_net. Daily tick. SECURITY DEFINER + search_path=''.$c$;

-- 4. Schedule daily 12:00 UTC = 09:00 ART.
select cron.schedule(
  'process-pending-billing-dunning',
  '0 12 * * *',
  $cron$select public.process_pending_billing_dunning()$cron$
);
