-- =============================================================================
-- CHORE-C · WATCHDOG DUNNING RECOVERY
-- =============================================================================
--
-- El cron principal T-074 (process_pending_billing_dunning) hace claim+send+
-- update en 3 pasos por sender:
--   1. INSERT billing_notifications_log (resend_email_id NULL).
--   2. Resend.emails.send(...).
--   3. UPDATE log SET resend_email_id = data.id.
--
-- Si el proceso muere entre 1 y 3, la row queda NULL y el UNIQUE
-- (consultora_id, tipo, ref_id) NULLS NOT DISTINCT bloquea cualquier
-- reintento del cron daily → email nunca se envia.
--
-- Este watchdog cada 15 min POSTea al endpoint que detecta rows stale
-- (resend_email_id IS NULL + created_at < now()-5min) y las reintenta.
-- Resend dedupea 24h por idempotencyKey → si el primer send si llego
-- (solo crasheo el UPDATE local), no se duplica.
--
-- Pattern: replica process_pending_billing_dunning (T-074). Reutiliza
-- secrets ya existentes en vault: cron_dispatch_secret + cron_dispatch_base_url.
-- =============================================================================

create or replace function public.process_dunning_recovery()
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
    raise notice 'process_dunning_recovery: cron_dispatch_secret no configurado, skip tick';
    return;
  end if;
  if v_base_url is null then
    raise notice 'process_dunning_recovery: cron_dispatch_base_url no configurado, skip tick';
    return;
  end if;

  v_endpoint := v_base_url || '/api/cron/billing-dunning-recovery';

  -- POST async (pg_net no espera response). El handler hace queries +
  -- envios + log updates. No body necesario.
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

comment on function public.process_dunning_recovery() is
  $c$CHORE-C: watchdog que reintenta rows stale (resend_email_id NULL >5min) en billing_notifications_log via POST async a /api/cron/billing-dunning-recovery. Tick cada 15 min. SECURITY DEFINER + search_path=''.$c$;

-- Schedule cada 15 minutos. Cadencia: 4 chances/hr de recovery vs 1 dia
-- para el cron daily. Acotado por LIMIT 50 en el endpoint para evitar
-- runaway si hay backlog grande.
select cron.schedule(
  'process-dunning-recovery',
  '*/15 * * * *',
  $cron$select public.process_dunning_recovery()$cron$
);
