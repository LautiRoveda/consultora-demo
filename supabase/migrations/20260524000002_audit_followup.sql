-- AUD-001 + AUD-002 · Audit RLS pre-launch follow-up.
--
-- Atomic migration que cubre dos findings del audit RLS multi-tenant
-- pre-launch (ver docs/feedback/ + AUD-001/002 tickets).
--
-- AUD-001 (IMPORTANT) · Immutability triggers en billing_notifications_log.
--   Patrón replicado de notification_log_immutable() (T-031,
--   supabase/migrations/20260515095701_notifications_infrastructure.sql:191).
--   Sin esto, un bug en el cron de dunning o un service-role mal usado
--   podría UPDATE/DELETE rows del log — invalida la garantía de
--   inmutabilidad esperada para tablas de bitácora (audit_log, notification_log
--   ya lo tienen). Triggers BEFORE UPDATE/DELETE que tiran raise exception,
--   coherente con el resto de logs inmutables del schema.
--
-- AUD-002 (IMPORTANT) · DROP epp_planificaciones_insert_own.
--   La policy original (T-100, supabase/migrations/20260523000001_t100_epp_schema.sql:1115)
--   permitía INSERT a cualquier member con scope `is_member_of_consultora(...)`.
--   En la práctica todas las inserts vienen de
--   gen_epp_planificaciones_y_calendar_for(uuid) (security definer + grant
--   sólo a service_role). Un member malicioso del propio tenant podría crear
--   planificaciones falsas → ruido en calendario + reminders falsos. Removemos
--   la policy: default-deny para authenticated, service-role sigue
--   bypaseando RLS desde la función publica invocada por T-102.
--
-- Sin cambios a helpers T-015 ni a audit_log. Sin tablas nuevas.


-- =============================================================================
-- AUD-001 · billing_notifications_log immutable
-- =============================================================================

create or replace function public.billing_notifications_log_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'billing_notifications_log es inmutable: % no permitido', tg_op;
end;
$$;

comment on function public.billing_notifications_log_immutable() is
  $c$AUD-001 · Trigger BEFORE UPDATE/DELETE en billing_notifications_log: rechaza la operación. INSERT-only enforced en DB. Replica patrón de notification_log_immutable() (T-031).$c$;

create trigger billing_notifications_log_no_update
  before update on public.billing_notifications_log
  for each row execute function public.billing_notifications_log_immutable();

create trigger billing_notifications_log_no_delete
  before delete on public.billing_notifications_log
  for each row execute function public.billing_notifications_log_immutable();


-- =============================================================================
-- AUD-002 · DROP epp_planificaciones_insert_own
-- =============================================================================
--
-- Member INSERT removed AUD-002 — function gen_epp_planificaciones_y_calendar_for(uuid)
-- es la única vía válida. Si emerge necesidad de INSERT manual por member en
-- el futuro (ej: UI de planificación manual), sumar policy específica con
-- scope acotado (no la blanket `is_member_of_consultora` original).

drop policy if exists epp_planificaciones_insert_own on public.epp_planificaciones;
