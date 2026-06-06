-- =============================================================================
-- T-121 (B) · audit_consultoras() + 2 triggers (INSERT/UPDATE) -> audit_log.
-- =============================================================================
-- PORQUE: consultoras es la única tabla raíz del dominio SIN audit_<tabla>(). Los
-- flips de plan/trial_hasta billing-driven que setea el trigger T-122
-- (sync_consultora_plan_from_suscripcion) NO quedaban en audit_log. T-122 lo dejó
-- explícito como T-121 ("El audit de los flips de plan es T-121").
--
-- MOLDE: audit_calendar_events() (20260514125515_calendar_events.sql) — security
-- definer, search_path='', escribe public.audit_log, diff-guard is-distinct-from,
-- verbos canónicos created/updated. security definer es necesario porque audit_log
-- no tiene policy de INSERT para authenticated (solo service-role/triggers).
--
-- ACTOR NULL TOLERADO: audit_log.actor_user_id es nullable (references auth.users(id)
-- on delete set null). Cuando el trigger T-122 corre en contexto webhook/cron
-- (service-role) y updatea consultoras.plan, este trigger dispara con auth.uid()=NULL
-- -> la fila se inserta limpia (mismo patrón que el audit de T-118/T-119 al cerrar por
-- proceso). NULL es la señal correcta de "actor = sistema"; NO usar coalesce a sentinel.
--
-- COLUMNAS (8, sin logo_storage_path): name, slug, cuit, plan, trial_hasta,
-- archived_at, auto_create_event_on_sign, retencion_datos_hasta. logo_storage_path
-- EXCLUIDO del guard y del payload (T-024 ya decidió que el cambio de logo se loguea en
-- pino+Sentry, no en audit_log). plan + trial_hasta van sí o sí (el punto del ticket).
--
-- SIN DELETE TRIGGER (desviación consciente del "3 triggers" del ticket): un hard-
-- delete de consultoras ya es IMPOSIBLE — audit_log.consultora_id -> consultoras es
-- ON DELETE RESTRICT y audit_log es INMUTABLE (sin DELETE posible), así que cualquier
-- consultora con historial de audit no se puede borrar. Y aunque se pudiera, un AFTER
-- DELETE insertando un audit row con consultora_id=old.id violaría ese mismo FK (la
-- consultora ya no existe). El molde tiene rama DELETE porque ahí la entidad != su
-- propio tenant; acá la entidad ES el tenant. El soft-delete real (archived_at) lo
-- captura el UPDATE trigger (archived_at está en el guard + payload).
-- =============================================================================

create or replace function public.audit_consultoras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (new.id, auth.uid(), 'created', 'consultoras', new.id,
       null,
       jsonb_build_object(
         'name', new.name,
         'slug', new.slug,
         'cuit', new.cuit,
         'plan', new.plan,
         'trial_hasta', new.trial_hasta
       ));
    return new;

  elsif tg_op = 'UPDATE' then
    if (new.name, new.slug, new.cuit, new.plan, new.trial_hasta, new.archived_at,
        new.auto_create_event_on_sign, new.retencion_datos_hasta)
       is distinct from
       (old.name, old.slug, old.cuit, old.plan, old.trial_hasta, old.archived_at,
        old.auto_create_event_on_sign, old.retencion_datos_hasta) then
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.id, auth.uid(), 'updated', 'consultoras', new.id,
         jsonb_build_object(
           'name', old.name,
           'slug', old.slug,
           'cuit', old.cuit,
           'plan', old.plan,
           'trial_hasta', old.trial_hasta,
           'archived_at', old.archived_at,
           'auto_create_event_on_sign', old.auto_create_event_on_sign,
           'retencion_datos_hasta', old.retencion_datos_hasta
         ),
         jsonb_build_object(
           'name', new.name,
           'slug', new.slug,
           'cuit', new.cuit,
           'plan', new.plan,
           'trial_hasta', new.trial_hasta,
           'archived_at', new.archived_at,
           'auto_create_event_on_sign', new.auto_create_event_on_sign,
           'retencion_datos_hasta', new.retencion_datos_hasta
         ));
    end if;
    return new;
  end if;
  -- SIN rama DELETE: hard-delete de consultoras imposible (audit_log RESTRICT +
  -- inmutable). El soft-delete (archived_at) lo captura la rama UPDATE.
  return null;
end;
$$;

comment on function public.audit_consultoras() is
  'T-121: trigger AFTER INSERT/UPDATE que escribe a audit_log en cambios de '
  'consultoras. Molde audit_calendar_events. Diff-guard sobre 8 mutables (name, '
  'slug, cuit, plan, trial_hasta, archived_at, auto_create_event_on_sign, '
  'retencion_datos_hasta); logo_storage_path EXCLUIDO (T-024: va a pino+Sentry). '
  'Audita los flips de plan/trial_hasta de T-122 con actor_user_id NULL cuando el '
  'trigger corre en contexto service-role/cron (audit_log.actor_user_id es nullable). '
  'SIN rama/trigger DELETE: hard-delete de consultoras imposible (audit_log es '
  'ON DELETE RESTRICT + inmutable); el soft-delete archived_at lo captura el UPDATE.';

create trigger audit_consultoras_after_insert
  after insert on public.consultoras
  for each row execute function public.audit_consultoras();

create trigger audit_consultoras_after_update
  after update on public.consultoras
  for each row execute function public.audit_consultoras();

-- SIN audit_consultoras_after_delete (ver header: audit_log RESTRICT + inmutable).
