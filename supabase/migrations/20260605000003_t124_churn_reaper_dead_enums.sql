-- =============================================================================
-- T-124 · Churn reaper (cierra el gap de T-122) + limpieza de enums muertos.
-- =============================================================================
-- PORQUE (A): una suscripción 'cancelada' cuyo período de acceso terminó queda
-- 'cancelada' para siempre -> el trigger T-122 la cuenta como pago-significativa ->
-- consultoras.plan='pro' aunque churneó (el badge de trial del sidebar miente). El gate
-- (access.ts) además leakeaba acceso para una cancelada con cancelar_en NULL (cancelada
-- por MP por falta de pago) -> ya corregido en la capa app (T-124). FIX estructural acá:
-- un reaper flipa esas filas 'cancelada' terminadas a 'expirada'; como el UPDATE toca
-- estado, dispara el trigger T-122 -> recomputa consultoras.plan='trial', y el gate pasa
-- a bloquear por la rama 'expirada'. Mismo patrón ADR-0015 que T-122/T-123 (fuente única
-- + sync por trigger; acá el reaper es el productor del estado terminal 'expirada').
--
-- PORQUE (B): enums muertos confirmados por auditoría:
--  - calendar_event_reminders.status='failed' nunca se escribe (el cron sólo escribe
--    'sent'; el fallo vive en notification_log) -> REMOVER del CHECK + sync del espejo TS
--    REMINDER_STATUS_VALUES (calendario/defaults.ts).
--  - suscripciones.estado: 'expirada' queda ACTIVADO por este reaper (antes nunca
--    seteado), 'trial' nunca se setea (createSubscription arranca en
--    'pendiente_autorizacion'; el trial real vive en consultoras.plan) -> REDOCUMENTAR.
--  - informes.status='archived' es soft-delete DISEÑADO-NO-IMPLEMENTADO (espejo del CHECK
--    en INFORME_STATUSES + wiring TS vivo: label, PublishButton, unpublishInformeAction)
--    -> NO se remueve, sólo se REDOCUMENTA el comment.
--
-- PREDICADO DEL REAPER: estado='cancelada' AND (cancelar_en IS NULL OR cancelar_en < now()).
--   cancelar_en < now()  = gracia user-iniciada vencida (cancelSubscriptionAction stampa
--                          cancelar_en=now() al pedido; el gate ya bloquea ese caso).
--   cancelar_en IS NULL  = cancelada por MP por falta de pago (el webhook setea
--                          cancelada_en, deja cancelar_en NULL). Ya churneada (MP agotó
--                          reintentos en 'morosa' antes de 'cancelada') -> reap inmediato.
--   cancelar_en > now()  = período de gracia vivo -> NO se toca.
--
-- ENGRANE T-122: el reaper flipa N filas en un UPDATE; T-122 es FOR EACH ROW pero
-- recomputa con un EXISTS sobre TODAS las suscripciones de la consultora (VIGENTE, no
-- NEW) -> tras flipear la última fila pago-significativa converge a plan='trial'; los
-- guards is-distinct-from hacen no-op las invocaciones intermedias. Una consultora con
-- una suscripción viva (activa/morosa) NO se degrada. No hay recursión (T-122 sólo
-- escribe consultoras, que no escribe suscripciones).
--
-- NO-CLASH cron: 'process-subscription-churn' (0 3 * * *, SQL puro sobre suscripciones)
-- vs 'process-dunning-recovery' (*/15, http_post -> billing_notifications_log) y
-- 'process-pending-billing-dunning' (0 12, http_post): job names distintos (sin
-- upsert-by-name colisión) + tablas disjuntas (sin contención de filas).
--
-- SEGURIDAD: security definer + search_path='' (el reaper es un sweep global cross-tenant;
-- el UPDATE de suscripciones es service_role-only por RLS). pg_cron lo corre como owner
-- (no necesita grant); grant a service_role sólo para que el test lo invoque por RPC.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A.1 · Función reaper.
-- -----------------------------------------------------------------------------
create or replace function public.process_subscription_churn()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
begin
  update public.suscripciones
     set estado = 'expirada'
   where estado = 'cancelada'
     and (cancelar_en is null or cancelar_en < now());
  get diagnostics v_count = row_count;
  raise notice 'T-124 reaper: % suscripciones cancelada->expirada', v_count;
  return v_count;
end;
$$;

comment on function public.process_subscription_churn() is
  'T-124: churn reaper. Flipea suscripciones cancelada cuyo período de acceso terminó '
  '(cancelar_en NULL = cancelada por MP por falta de pago | cancelar_en < now() = gracia '
  'user-iniciada vencida) a estado=expirada. El UPDATE dispara T-122 (AFTER UPDATE OF '
  'estado) -> recomputa consultoras.plan=trial; el gate bloquea expirada. Idempotente '
  '(re-run = 0 filas). security definer: sweep global cross-tenant. Lo corre el cron '
  'diario process-subscription-churn (03:00).';

revoke execute on function public.process_subscription_churn() from public, authenticated;
grant execute on function public.process_subscription_churn() to service_role;

-- -----------------------------------------------------------------------------
-- A.2 · Schedule diario (SQL puro, no http_post: es un UPDATE interno).
-- Guard unschedule: pg_cron upserta por jobname, pero el repo no tiene precedente de
-- re-schedule; el guard deja la migración re-aplicable limpia bajo `db reset`.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'process-subscription-churn') then
    perform cron.unschedule('process-subscription-churn');
  end if;
end $$;

select cron.schedule(
  'process-subscription-churn',
  '0 3 * * *',
  $cron$select public.process_subscription_churn()$cron$
);

-- -----------------------------------------------------------------------------
-- A.3 · Backfill one-time (idempotente): expira las canceladas ya vencidas en prod.
-- El UPDATE dispara T-122 -> corrige sus consultoras.plan a trial. Re-run = 0 filas.
-- -----------------------------------------------------------------------------
do $$
declare
  v_count int := 0;
begin
  v_count := public.process_subscription_churn();
  raise notice 'T-124 backfill: % suscripciones expiradas (T-122 recomputó consultoras.plan)', v_count;
end $$;

-- -----------------------------------------------------------------------------
-- B.1 · calendar_event_reminders.status: REMOVER 'failed' del CHECK.
-- 'failed' nunca se escribe (el fallo vive en notification_log). Mantiene
-- pending/sent/skipped (T-123 escribe 'skipped'). Drop name-agnostic (el CHECK es inline
-- sin nombre -> lo resolvemos por def por robustez), re-add con nombre explícito.
-- Guard: aborta con mensaje claro si hubiera filas con 'failed' (no debería; el ALTER ADD
-- fallaría igual, pero el RAISE es más legible).
-- -----------------------------------------------------------------------------
do $$
declare
  v_con text;
  v_bad int := 0;
begin
  select count(*) into v_bad from public.calendar_event_reminders where status = 'failed';
  if v_bad > 0 then
    raise exception 'T-124: % reminders con status=failed; no se puede estrechar el CHECK', v_bad;
  end if;

  select conname into v_con
    from pg_constraint
   where conrelid = 'public.calendar_event_reminders'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%failed%';
  if v_con is not null then
    execute format('alter table public.calendar_event_reminders drop constraint %I', v_con);
  end if;
end $$;

alter table public.calendar_event_reminders
  add constraint calendar_event_reminders_status_check
  check (status in ('pending', 'sent', 'skipped'));

-- -----------------------------------------------------------------------------
-- B.2 · Redocumentar comments (sin cambiar data ni el enum TYPE / CHECK de informes).
-- -----------------------------------------------------------------------------
comment on type public.estado_suscripcion is
  'T-124: trial=RESERVADO (no usado; el trial real vive en consultoras.plan, '
  'createSubscription arranca en pendiente_autorizacion) | pendiente_autorizacion | '
  'activa | morosa | cancelada (user pidió + confirmado MP) | expirada (churned: '
  'cancelada cuyo período de acceso terminó, seteado por el reaper process_subscription_churn).';

comment on column public.suscripciones.estado is
  'Estado MP. trial=RESERVADO (no usado; el trial real vive en consultoras.plan) | '
  'pendiente_autorizacion | activa (pagando) | morosa (intento fallido reciente) | '
  'cancelada (user pidió + confirmado MP) | expirada (churned: cancelada cuyo período '
  'terminó, seteado por el reaper T-124 process_subscription_churn). pago-significativo '
  'para consultoras.plan=pro (trigger T-122): activa,morosa,cancelada.';

comment on column public.informes.status is
  'draft (en edición) | published (firmado por el profesional) | archived (RESERVADO: '
  'soft-delete diseñado, no implementado; espejo del CHECK en INFORME_STATUSES, T-124).';
