-- T-036 · Integracion Informes <-> Calendario.
--
-- Suma dos columnas + extiende audit trigger T-027.
--
-- 1. calendar_events.parent_event_id: distingue origen del evento.
--    - Auto-creado por completeCalendarEventAction (chain de recurrencia, T-028):
--      parent_event_id != NULL (apunta al evento original que se completo).
--    - Creado al firmar informe (T-036 modal o silent): informe_id != NULL,
--      parent_event_id = NULL.
--    - Creado manual desde UI (T-029): ambos NULL.
--
--    Destraba TODO inline en EventViewPanel.tsx:44-47 (T-029) que mostraba
--    copy "auto-creado por recurrencia" via heuristica no confiable.
--
--    FK ON DELETE SET NULL: si admin borra un evento padre, los hijos sobreviven
--    con parent_event_id = NULL (cleanup admin de un evento cancelled hace meses
--    no debe borrar la cadena de hijos activos).
--
-- 2. consultoras.auto_create_event_on_sign: toggle DA-05 opt-in a Opcion A.
--    Default false = modal post-firma. True = silent auto-creation sin preguntar.
--    Per-consultora (no per-user): afecta a TODOS los users del tenant. Edicion
--    restringida a owner via permission gate en updateAutoCreateEventToggleAction.
--
-- 3. audit_calendar_events() extendido: parent_event_id en diff guard + payloads.
--    Coherente con el resto del guard. Cambios futuros (admin fix de chain via
--    service-role) quedan auditados sin extender trigger en otra migration.
--
-- RLS: no requiere nuevas policies. Las existentes de calendar_events (T-027)
-- filtran por consultora_id (mismo row) y cubren parent_event_id transparente.
-- Las existentes de consultoras (T-011) filtran UPDATE a owner via
-- consultoras_update_own_owner y cubren auto_create_event_on_sign igual.

-- =====================================================================
-- 1. parent_event_id en calendar_events
-- =====================================================================

alter table public.calendar_events
  add column parent_event_id uuid
    references public.calendar_events(id) on delete set null;

comment on column public.calendar_events.parent_event_id is
  'T-036: si != NULL, evento auto-creado por completeCalendarEventAction tras complete del padre (chain de recurrencia). Si NULL + informe_id != NULL = creado al firmar informe. Si ambos NULL = creado manual.';

-- Index partial para lookup de chains (poco frecuente pero barato).
create index idx_calendar_events_parent
  on public.calendar_events(parent_event_id)
  where parent_event_id is not null;

-- =====================================================================
-- 2. auto_create_event_on_sign en consultoras
-- =====================================================================

alter table public.consultoras
  add column auto_create_event_on_sign boolean not null default false;

comment on column public.consultoras.auto_create_event_on_sign is
  'T-036: si true, al publicar informe con tipo recurrente (rgrl/relevamiento/capacitacion) se crea vencimiento sin preguntar (silent path). Default false = modal post-firma. Per-consultora, owner-only edit.';

-- =====================================================================
-- 3. audit_calendar_events() extendido con parent_event_id
-- =====================================================================
--
-- Diff guard y payloads INSERT/UPDATE/DELETE incluyen ahora parent_event_id.
-- Cuerpo identico al original (T-027) salvo el nuevo campo.

create or replace function public.audit_calendar_events()
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
      (new.consultora_id, auth.uid(), 'created', 'calendar_events', new.id,
       null,
       jsonb_build_object(
         'tipo', new.tipo,
         'titulo', new.titulo,
         'status', new.status,
         'fecha_vencimiento', new.fecha_vencimiento,
         'recurrence_months', new.recurrence_months,
         'informe_id', new.informe_id,
         'parent_event_id', new.parent_event_id
       ));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.titulo, new.tipo, new.status, new.fecha_vencimiento,
        new.recurrence_months, new.descripcion, new.completed_at,
        new.parent_event_id)
       is distinct from
       (old.titulo, old.tipo, old.status, old.fecha_vencimiento,
        old.recurrence_months, old.descripcion, old.completed_at,
        old.parent_event_id) then
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'calendar_events', new.id,
         jsonb_build_object(
           'titulo', old.titulo,
           'tipo', old.tipo,
           'status', old.status,
           'fecha_vencimiento', old.fecha_vencimiento,
           'recurrence_months', old.recurrence_months,
           'completed_at', old.completed_at,
           'parent_event_id', old.parent_event_id
         ),
         jsonb_build_object(
           'titulo', new.titulo,
           'tipo', new.tipo,
           'status', new.status,
           'fecha_vencimiento', new.fecha_vencimiento,
           'recurrence_months', new.recurrence_months,
           'completed_at', new.completed_at,
           'parent_event_id', new.parent_event_id
         ));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'calendar_events', old.id,
       jsonb_build_object(
         'titulo', old.titulo,
         'tipo', old.tipo,
         'status', old.status,
         'fecha_vencimiento', old.fecha_vencimiento,
         'parent_event_id', old.parent_event_id
       ),
       null);
    return old;
  end if;
  return null;
end;
$$;
