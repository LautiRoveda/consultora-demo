-- =============================================================================
-- T-118 · Sincronización calendario -> dominio.
-- PORQUE: editar fecha/estado de un evento en el calendario (updateCalendarEventAction /
-- completeCalendarEventAction) actualizaba calendar_events pero NO la tabla de
-- dominio (epp_planificaciones / acciones_correctivas), que es lo que leen
-- chat/ficha/padron (filtran por estado activo). Reprogramar o completar un evento
-- dejaba el dominio en la fecha/estado viejos (ej. "Guantes vaqueta cuero" movido a
-- 13/06 seguia en 24/11 en el chat).
--
-- FIX: trigger AFTER UPDATE que rutea por NEW.tipo y propaga fecha + status, con
-- WHEN clause (solo dispara si cambio fecha o status) y guarda de idempotencia
-- (no pisa estados finales). Cubre CUALQUIER origen (action/RPC/SQL) a nivel DB,
-- sin tocar TS.
--
-- NO-RECURSION: ningun trigger de epp_planificaciones/acciones_correctivas escribe
-- calendar_events (solo set_updated_at + audit_log append-only) y esta funcion no
-- escribe calendar_events -> el grafo termina en audit_log, no cicla.
--
-- NO-CONFLICTO vs T-119: la RPC gen_epp_planificaciones_y_calendar_for marca la
-- planif previa 'cumplida' ANTES de completar su calendar_event; cuando ese UPDATE
-- dispara este trigger, la planif ya esta cumplida -> guard 'estado not in
-- (finales)' = 0 rows = no-op. El fix de escritura separada (fecha solo si cambio)
-- evita ademas reescribir la fecha en ese status-flip.
--
-- NOTA T-120 (lifecycle CAPAs): este trigger habilita incidentalmente cerrar una
-- CAPA completando su evento desde el calendario (accion_correctiva -> 'cerrada',
-- cerrada_por NULL = cierre por proceso). Adelanta parte de T-120 (cierre CON
-- evidencia desde la ficha de inspeccion, que setearia cerrada_por/evidencia_cierre);
-- no conflictua.
-- =============================================================================
create or replace function public.sync_calendar_event_to_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- epp_entrega -> epp_planificaciones.
  -- fecha (solo si cambio): date @ 12:00 UTC = espejo de computeScheduledAtUtc
  --   (SCHEDULED_AT_SEND_HOUR_UTC = 12 = 09:00 ART). Escritura separada del status
  --   para que un cambio solo-de-status NO reescriba la fecha (sin churn de hora ni
  --   diff de audit espurio).
  -- status: completed->cumplida / cancelled->cancelada.
  -- Guard 'estado not in (finales)': idempotente y NO-OP vs T-119.
  if new.tipo = 'epp_entrega' then
    update public.epp_planificaciones
       set fecha_proxima_entrega = case
             when new.fecha_vencimiento is distinct from old.fecha_vencimiento
               then (new.fecha_vencimiento::timestamp + interval '12 hours') at time zone 'UTC'
             else fecha_proxima_entrega
           end,
           estado = case
             when new.status = 'completed' then 'cumplida'::public.estado_planificacion_epp
             when new.status = 'cancelled' then 'cancelada'::public.estado_planificacion_epp
             else estado
           end
     where calendar_event_id = new.id
       and estado not in ('cumplida', 'cancelada');

  -- accion_correctiva -> acciones_correctivas.
  -- fecha (solo si cambio): date->date directo. status: completed->cerrada
  --   (+cerrada_at=now() solo en la transicion) / cancelled->anulada.
  -- cerrada_por queda NULL (cierre por proceso, espeja la convencion de T-119).
  elsif new.tipo = 'accion_correctiva' then
    update public.acciones_correctivas
       set fecha_compromiso = case
             when new.fecha_vencimiento is distinct from old.fecha_vencimiento
               then new.fecha_vencimiento
             else fecha_compromiso
           end,
           estado = case
             when new.status = 'completed' then 'cerrada'
             when new.status = 'cancelled' then 'anulada'
             else estado
           end,
           cerrada_at = case
             when new.status = 'completed' and old.status is distinct from 'completed'
               then now()
             else cerrada_at
           end
     where calendar_event_id = new.id
       and estado not in ('cerrada', 'anulada');
  end if;

  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$$;

comment on function public.sync_calendar_event_to_origin() is
  'T-118: AFTER UPDATE de calendar_events. Propaga fecha (y status) editados en el '
  'calendario al dominio que leen chat/ficha/padron: epp_entrega->epp_planificaciones '
  '(fecha_proxima_entrega @ 12:00 UTC, estado cumplida/cancelada) y accion_correctiva->'
  'acciones_correctivas (fecha_compromiso date, estado cerrada/anulada +cerrada_at). '
  'Guard estado not in (finales): idempotente y no-op vs T-119. security definer '
  'bypassa RLS (cross-tenant-safe: solo toca filas con calendar_event_id = NEW.id).';

-- WHEN clause: solo dispara si cambio fecha o status. Asi un UPDATE de
-- titulo/descripcion/metadata/reminder_offsets (o el set_updated_at) NO toca el
-- dominio ni ensucia el audit_log.
drop trigger if exists sync_calendar_event_to_origin_after_update on public.calendar_events;
create trigger sync_calendar_event_to_origin_after_update
  after update on public.calendar_events
  for each row
  when (
    old.fecha_vencimiento is distinct from new.fecha_vencimiento
    or old.status is distinct from new.status
  )
  execute function public.sync_calendar_event_to_origin();

-- =============================================================================
-- BACKFILL T-118 (SOLO FECHA, F3): re-sincroniza la fecha del dominio ACTIVO a la
-- del evento linkeado cuando el DIA difiere (el usuario edito el evento -> gana el
-- evento). DATE-GRANULAR a proposito: fecha_proxima_entrega/fecha_compromiso pueden
-- tener cualquier hora (epp_entregas.fecha_entrega es timestamptz); comparar el
-- INSTANTE reescribiria casi toda la tabla. Comparamos el DIA en UTC -> solo toca
-- desincronizados reales (ej. Guantes de Roveda: evento 13/06 vs planif 24/11).
-- El conteo puede dar >1: cualquier planif vieja con hora != 12:00 UTC cuyo dia UTC
-- difiera tambien entra; re-sincronizarla es benigno (normaliza la hora al MISMO
-- dia civil, 12:00 UTC). NO toca status historico.
-- Idempotente: tras correr, el dia coincide -> re-run = 0 rows.
-- =============================================================================
do $$
declare
  v_epp      int := 0;
  v_acciones int := 0;
begin
  update public.epp_planificaciones p
     set fecha_proxima_entrega = (ce.fecha_vencimiento::timestamp + interval '12 hours') at time zone 'UTC'
    from public.calendar_events ce
   where p.calendar_event_id = ce.id
     and p.estado = 'activa'
     and (p.fecha_proxima_entrega at time zone 'UTC')::date is distinct from ce.fecha_vencimiento;
  get diagnostics v_epp = row_count;

  update public.acciones_correctivas a
     set fecha_compromiso = ce.fecha_vencimiento
    from public.calendar_events ce
   where a.calendar_event_id = ce.id
     and a.estado in ('abierta', 'en_progreso')
     and a.fecha_compromiso is distinct from ce.fecha_vencimiento;
  get diagnostics v_acciones = row_count;

  raise notice 'T-118 backfill: % planif EPP + % acciones re-sincronizadas (solo fecha)', v_epp, v_acciones;
end $$;
