-- =============================================================================
-- T-114 · Fix: gen_epp_planificaciones_y_calendar_for no creaba reminders.
-- =============================================================================
-- PORQUE: la RPC (T-100) insertaba el calendar_event (reminder_offsets_days
-- [14,3,0]) + la epp_planificacion, pero NUNCA poblaba calendar_event_reminders.
-- El cron process_pending_reminders (T-031) escanea esa tabla -> 0 filas -> los
-- vencimientos de EPP (renovacion 6m, Res SRT 299/11) jamas dispararon
-- Resend/Telegram/Push en prod. El path TS createCalendarEventAction SI crea
-- reminders (computeReminderRows), por eso solo la RPC EPP quedaba muda.
--
-- FIX (forward): replicar el patron probado de gen_acciones_calendar_for (T-057):
-- por cada offset insertar el reminder con scheduled_at = (fecha_vencimiento -
-- offset dias) a las 12:00 UTC (= 09:00 ART, SCHEDULED_AT_SEND_HOUR_UTC),
-- omitiendo los que cayeron en el pasado. Espejo exacto de computeScheduledAtUtc.
-- Se mantiene firma, security definer, search_path='' y los grants de T-100.
-- NO se modifica el insert de calendar_events ni de epp_planificaciones.
create or replace function public.gen_epp_planificaciones_y_calendar_for(p_entrega_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entrega       record;
  v_empleado      record;
  v_item          record;
  v_vida_util     int;
  v_fecha_proxima timestamptz;
  v_calendar_id   uuid;
  v_offsets       int[] := array[14, 3, 0];  -- cadencia EPP (discovery seccion 4); single-source
  v_offset        int;
  v_scheduled     timestamptz;
begin
  select id, consultora_id, empleado_id, fecha_entrega, created_by
    into v_entrega
    from public.epp_entregas
    where id = p_entrega_id;

  if v_entrega.id is null then
    raise exception 'epp_entregas % no encontrada', p_entrega_id using errcode = '02000';
  end if;

  select e.nombre, e.apellido
    into v_empleado
    from public.empleados e
    where e.id = v_entrega.empleado_id;

  for v_item in
    select ei.id           as entrega_item_id,
           ei.item_id,
           ei.vida_util_meses_override,
           i.nombre        as item_nombre,
           i.vida_util_meses,
           i.es_descartable
      from public.epp_entrega_items ei
      join public.epp_items i on i.id = ei.item_id
      where ei.entrega_id = p_entrega_id
        and i.es_descartable = false
  loop
    v_vida_util := coalesce(v_item.vida_util_meses_override, v_item.vida_util_meses);
    v_fecha_proxima := v_entrega.fecha_entrega + (v_vida_util || ' months')::interval;

    -- 1. Crear calendar_event (tipo='epp_entrega' reusa T-027, reminder
    --    offsets [14,3,0] estandar EPP definido en discovery seccion 4).
    insert into public.calendar_events (
      consultora_id, tipo, titulo, fecha_vencimiento,
      reminder_offsets_days, status, created_by, metadata
    ) values (
      v_entrega.consultora_id,
      'epp_entrega',
      'Vencimiento EPP: ' || v_item.item_nombre || ' — ' || v_empleado.nombre || ' ' || v_empleado.apellido,
      v_fecha_proxima::date,
      v_offsets,
      'pending',
      v_entrega.created_by,
      jsonb_build_object(
        'empleado_id', v_entrega.empleado_id,
        'epp_item_id', v_item.item_id,
        'epp_entrega_id', v_entrega.id,
        'vida_util_meses', v_vida_util
      )
    )
    returning id into v_calendar_id;

    -- 1b. Reminders (FIX T-114): scheduled_at = (fecha_vencimiento - offset dias)
    --     a las 12:00 UTC (= 09:00 ART, SCHEDULED_AT_SEND_HOUR_UTC). Omite los que
    --     cayeron en el pasado. v_fecha_proxima es timestamptz pero fecha_vencimiento
    --     se persiste como ::date -> usamos v_fecha_proxima::date (misma expresion que
    --     determina la fecha guardada -> espejo exacto de computeScheduledAtUtc).
    foreach v_offset in array v_offsets loop
      v_scheduled := ((v_fecha_proxima::date - v_offset)::timestamp + interval '12 hours')
                     at time zone 'UTC';
      if v_scheduled >= now() then
        insert into public.calendar_event_reminders (event_id, consultora_id, offset_days, scheduled_at, status)
          values (v_calendar_id, v_entrega.consultora_id, v_offset, v_scheduled, 'pending')
          on conflict (event_id, offset_days) do nothing;
      end if;
    end loop;

    -- 2. Crear epp_planificaciones linkeada al calendar_event.
    insert into public.epp_planificaciones (
      consultora_id, empleado_id, item_id, fecha_proxima_entrega, frecuencia_meses,
      generado_de_entrega_id, calendar_event_id, estado
    ) values (
      v_entrega.consultora_id,
      v_entrega.empleado_id,
      v_item.item_id,
      v_fecha_proxima,
      v_vida_util,
      v_entrega.id,
      v_calendar_id,
      'activa'
    );
  end loop;
end;
$$;

-- SEGURIDAD: identico a T-100. revoke from public/anon/authenticated, grant solo
-- service_role (security definer bypassa RLS -> riesgo cross-tenant). Idempotente.
revoke execute on function public.gen_epp_planificaciones_y_calendar_for(uuid)
  from public, anon, authenticated;
grant execute on function public.gen_epp_planificaciones_y_calendar_for(uuid) to service_role;

comment on function public.gen_epp_planificaciones_y_calendar_for(uuid) is
  'T-100/T-114: post-entrega EPP. Por cada epp_entrega_items con item.es_descartable=false '
  'genera epp_planificaciones + calendar_events (tipo=epp_entrega, offsets [14,3,0]) + las '
  'filas de calendar_event_reminders (replica computeReminderRows: 12:00 UTC, omite pasado). '
  'SOLO invocable con service_role: security definer bypassa RLS (riesgo cross-tenant). '
  'Patron consistente con createServiceRoleClient en webhook MP / cron handlers.';

-- =============================================================================
-- BACKFILL T-114: los calendar_events tipo 'epp_entrega' creados ANTES de este fix
-- quedaron con reminder_offsets_days pero sin filas en calendar_event_reminders ->
-- nunca dispararon. Rellenamos con la misma formula (12:00 UTC, omitir pasado).
-- Idempotente: NOT EXISTS + ON CONFLICT -> re-ejecutable sin efectos.
-- OJO: aca fecha_vencimiento ya es 'date' -> sin ::date cast (a diferencia de la
-- var timestamptz de la RPC).
-- =============================================================================
do $$
declare
  v_ev        record;
  v_offset    int;
  v_scheduled timestamptz;
  v_count     int := 0;
begin
  for v_ev in
    select id, consultora_id, fecha_vencimiento, reminder_offsets_days
      from public.calendar_events ce
      where ce.tipo = 'epp_entrega'
        and ce.status = 'pending'
        and not exists (
          select 1 from public.calendar_event_reminders r where r.event_id = ce.id
        )
  loop
    foreach v_offset in array v_ev.reminder_offsets_days loop
      v_scheduled := ((v_ev.fecha_vencimiento - v_offset)::timestamp + interval '12 hours')
                     at time zone 'UTC';
      if v_scheduled >= now() then
        insert into public.calendar_event_reminders (event_id, consultora_id, offset_days, scheduled_at, status)
          values (v_ev.id, v_ev.consultora_id, v_offset, v_scheduled, 'pending')
          on conflict (event_id, offset_days) do nothing;
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;
  raise notice 'T-114 backfill: % reminders EPP creados', v_count;
end $$;
