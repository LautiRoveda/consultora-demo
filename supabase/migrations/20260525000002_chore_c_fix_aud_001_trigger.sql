-- =============================================================================
-- CHORE-C · FIX AUD-001 IMMUTABLE TRIGGER (refinar semántica)
-- =============================================================================
--
-- AUD-001 (20260524000002_audit_followup.sql) agregó triggers
-- BEFORE UPDATE/DELETE en billing_notifications_log que RECHAZAN ambas
-- operaciones sin excepción. Esto rompió silenciosamente el flujo T-074:
--   - El cron daily hace UPDATE billing_notifications_log SET resend_email_id =
--     data.id POST-Resend.send (markLogResendId).
--   - El UPDATE falla con "es inmutable" → markLogResendId/markLogFailed lo
--     loguean con warn (NO throw, por diseño "non-fatal") → row queda con
--     resend_email_id NULL.
--   - Resultado: desde el 2026-05-24, todos los emails dunning sí se envían
--     pero NINGUNO queda marcado como confirmado en DB.
--   - El cron diario, en runs subsiguientes, ve la row existente → UNIQUE
--     conflict → skip. Resend dedupea por idempotencyKey 24h, así que no
--     hay spam, pero la observabilidad de dunning queda completamente rota.
--
-- CHORE-C (watchdog) por diseño hace EXACTAMENTE el mismo UPDATE → mismo
-- bloqueo → livelock: el watchdog corre cada 15 min, re-renderiza,
-- re-envía (Resend dedupea), intenta UPDATE → blocked → row sigue NULL →
-- siguiente tick lo agarra de nuevo. Para siempre.
--
-- Fix: refinar el trigger para permitir SOLO la transición legítima:
--   - resend_email_id pasa de NULL a non-NULL.
--   - Ninguna otra columna cambia.
-- Cualquier otro UPDATE → rechazado.
-- DELETE → sigue rechazado (preserva append-only para audit).
--
-- Invariante preservado: el log sigue siendo append-only en todos los
-- datos identificadores (consultora_id, tipo, ref_id, sent_at, created_at).
-- La única mutación permitida es marcar "esta fila fue enviada" una sola
-- vez. Equivalente a un campo computed at-send-time.
-- =============================================================================

create or replace function public.billing_notifications_log_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Transición permitida: claim → confirmed. resend_email_id pasa de NULL
    -- a non-NULL una sola vez. El resto de columnas debe ser idéntico.
    if old.resend_email_id is null
       and new.resend_email_id is not null
       and old.id = new.id
       and old.consultora_id = new.consultora_id
       and old.tipo = new.tipo
       and old.ref_id is not distinct from new.ref_id
       and old.sent_at = new.sent_at
       and old.created_at = new.created_at
    then
      return new;
    end if;
    raise exception
      'billing_notifications_log: solo permitida la transición resend_email_id NULL → non-NULL, ninguna otra columna';
  end if;
  raise exception 'billing_notifications_log es inmutable: % no permitido', tg_op;
end;
$$;

comment on function public.billing_notifications_log_immutable() is
  $c$CHORE-C · Refinado de AUD-001. UPDATE permitido SOLO en transición resend_email_id NULL → non-NULL (mark-confirmed flow). Resto de columnas no mutables. DELETE rechazado.$c$;

-- Triggers existentes (billing_notifications_log_no_update / _no_delete)
-- siguen apuntando a esta función. CREATE OR REPLACE FUNCTION los preserva.
