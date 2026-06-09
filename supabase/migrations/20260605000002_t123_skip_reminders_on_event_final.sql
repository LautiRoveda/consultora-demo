-- =============================================================================
-- T-123 · Skip defensivo de reminders al finalizar un evento.
-- PORQUE: cuando un calendar_event pasa a final (completed/cancelled), sus
-- reminders 'pending' deben quedar 'skipped' (no spam de un vencimiento ya
-- resuelto). Hoy ese skip se repite "por disciplina" en varios sitios TS/SQL
-- (complete/cancel actions, anularEjecucion, resolverCapa T-120, RPC T-119).
-- Si un evento se finaliza por un camino que NO skipea (UPDATE directo SQL/
-- service-role, o futuro), los reminders quedan 'pending' zombie: hoy es seguro
-- (el cron process_pending_reminders y el dispatcher filtran ce.status='pending'),
-- pero es consistencia por disciplina, no estructural, y ensucia idx_reminders_due
-- (where status='pending'). ADR-0015: red estructural por trigger (idea de T-118).
--
-- ALCANCE (Opcion A acotada): este trigger es la FUENTE ESTRUCTURAL del skip.
-- complete/cancelCalendarEventAction YA NO skipean explicitamente: el trigger es
-- AFTER UPDATE -> corre ANTES del skip de la action, que entonces veia 0 filas
-- pending (su campo remindersSkipped, no usado por la UI, se quito). Los otros 3
-- skips explicitos (anularEjecucionAction, resolverCapaAction T-120, RPC T-119) se
-- MANTIENEN como redundantes inofensivos: idempotentes (where status='pending'),
-- sin count asertado, y quitar el de la RPC obligaria a redefinir una migracion ya
-- aplicada. El trigger y esos 3 coexisten sin pisarse (re-skip = 0 filas).
--
-- SECURITY DEFINER (requerido, no solo defensivo): complete/cancelCalendarEvent
-- actualizan calendar_events con el cliente USER-scoped (calendario/actions.ts),
-- y calendar_event_reminders tiene UPDATE default-deny para authenticated. Un
-- trigger SECURITY INVOKER correria el update de reminders como ese user -> RLS
-- niega -> 0 filas en silencio. security definer bypassa RLS; cross-tenant-safe:
-- solo toca filas con event_id = NEW.id (la fila que el user ya paso por RLS).
--
-- NO-RECURSION: calendar_event_reminders no tiene NINGUN trigger y nunca escribe
-- calendar_events. El unico write de esta funcion es a calendar_event_reminders
-- (hoja del grafo) -> no re-entra a si misma ni a otro trigger de calendar_events.
--
-- NO-CONFLICTO vs T-118: en un mismo UPDATE pending->final de un epp_entrega/
-- accion_correctiva disparan AMBOS triggers. Tocan tablas DISJUNTAS (T-118 ->
-- epp_planificaciones/acciones_correctivas; T-123 -> calendar_event_reminders;
-- audit -> audit_log). El orden de firing (alfabetico por nombre de trigger) es
-- irrelevante: ninguno lee lo que el otro escribe dentro del statement.
--
-- NOTA: si alguna vez se agrega una accion de "reabrir" evento (final->pending),
-- debe re-materializar los reminders: este trigger solo dispara en pending->final.
-- Hoy no existe tal camino (complete/cancel hard-gatean event.status='pending').
-- =============================================================================
create or replace function public.skip_reminders_on_event_final()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.calendar_event_reminders
     set status = 'skipped'
   where event_id = new.id
     and status = 'pending';
  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$$;

comment on function public.skip_reminders_on_event_final() is
  'T-123: AFTER UPDATE de calendar_events. Cuando un evento pasa a final '
  '(completed/cancelled), skipea sus reminders pending (no spam de un vencimiento '
  'ya resuelto). Fuente estructural del skip; cubre todo camino (action/RPC/SQL '
  'directo/futuro). security definer bypassa RLS (calendar_event_reminders UPDATE '
  'es default-deny para authenticated; cross-tenant-safe: solo toca filas con '
  'event_id = NEW.id).';

-- WHEN clause: solo el flip pending -> final. 'pending' es el unico estado no-final
-- (CHECK status in pending/completed/cancelled), asi que old.status='pending' = "venia
-- de no-final". final->final (completed->cancelled) NO dispara (old.status != 'pending')
-- y seria no-op igual (los reminders ya estaban skipped). OF status: el UPDATE debe
-- asignar la columna status (evita encolar el trigger en updates de titulo/fecha/etc).
drop trigger if exists skip_reminders_on_event_final_after_update on public.calendar_events;
create trigger skip_reminders_on_event_final_after_update
  after update of status on public.calendar_events
  for each row
  when (old.status = 'pending' and new.status in ('completed', 'cancelled'))
  execute function public.skip_reminders_on_event_final();

-- =============================================================================
-- BACKFILL T-123 (idempotente): skipea los reminders 'pending' zombie de eventos
-- que YA estan en estado final. Re-run = 0 filas (el filtro status='pending' deja
-- de matchear una vez skipeados). Mismo patron que el backfill de T-118/T-119.
-- =============================================================================
do $$
declare
  v_skipped int := 0;
begin
  update public.calendar_event_reminders
     set status = 'skipped'
   where status = 'pending'
     and event_id in (
       select id from public.calendar_events where status in ('completed', 'cancelled')
     );
  get diagnostics v_skipped = row_count;
  raise notice 'T-123 backfill: % reminders zombie skipeados (eventos ya finales)', v_skipped;
end $$;
