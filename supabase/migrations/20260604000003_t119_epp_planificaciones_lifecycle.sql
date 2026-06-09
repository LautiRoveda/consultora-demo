-- =============================================================================
-- T-119 · Lifecycle de planificaciones EPP: cerrar la activa previa al reentregar
-- + unicidad (<=1 activa por empleado/item) + backfill de las fantasma acumuladas.
-- =============================================================================
-- PORQUE: epp_planificaciones nacia 'activa' y nunca se cerraba (no habia
-- action/RPC/trigger/cron que la pasara a cumplida/cancelada; el comentario T-100
-- prometia una "T-102 server action" que jamas existio, y la policy update_own lo
-- permite pero nada lo ejecutaba). Cada reentrega del mismo EPP dejaba la anterior
-- activa -> vencimientos fantasma que calendario/chat/padron mostraban como
-- vigentes (todos filtran estado='activa').
--
-- FIX (3 partes, EL ORDEN IMPORTA): (1) la RPC cierra la planif activa previa del
-- mismo (empleado,item) ANTES de insertar la nueva, completa su calendar_event y
-- saltea sus reminders pending; (2) backfill idempotente que colapsa los
-- duplicados ya en prod; (3) unique parcial que blinda la invariante. El indice va
-- AL FINAL: fallaria si corriera antes del backfill (duplicados pre-existentes).
--
-- DEDUP (T-119): epp_entrega_items NO tiene unique (entrega_id,item_id) y el form
-- no deduplica, y la planificacion es por TIPO de EPP (no guarda numero_serie) ->
-- el cursor agrupa por item_id: 1 planif/evento por (empleado,item) por entrega.
-- Esto CAMBIA el comportamiento de T-114 SOLO para items repetidos en una misma
-- entrega (antes 2 eventos -> ahora 1, que es el correcto). Para entregas con
-- items distintos (el caso normal) el comportamiento es identico.
--
-- RACE: si dos reentregas del mismo (empleado,item) corren concurrentemente, ambas
-- cierran la previa e insertan; el unique parcial rechaza la segunda con 23505. La
-- RPC se invoca desde createEntregaAction con planificacionWarning NO-fatal -> la
-- entrega queda firmada y la planificacion se reintenta. El indice prioriza
-- consistencia (nunca 2 activas) sobre la corrida concurrente, que es lo correcto.
-- Edge rarisimo (mismo consultor reentregando el mismo EPP al mismo empleado en
-- paralelo); se documenta para que no sorprenda.
--
-- Mantiene firma, security definer, search_path='' y los grants de T-100/T-114.
create or replace function public.gen_epp_planificaciones_y_calendar_for(p_entrega_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entrega        record;
  v_empleado       record;
  v_item           record;
  v_vida_util      int;
  v_fecha_proxima  timestamptz;
  v_calendar_id    uuid;
  v_prev_event_ids uuid[];                     -- T-119: eventos de planif. previas cerradas
  v_offsets        int[] := array[14, 3, 0];   -- cadencia EPP (discovery seccion 4); single-source
  v_offset         int;
  v_scheduled      timestamptz;
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

  -- T-119 DEDUP: una fila por item_id (no por linea de entrega). vida_util
  -- representativa = la MINIMA entre lineas del mismo item (renovacion mas
  -- temprana = mas conservador para Res SRT 299/11).
  for v_item in
    select ei.item_id,
           min(coalesce(ei.vida_util_meses_override, i.vida_util_meses)) as vida_util,
           max(i.nombre)                                                 as item_nombre
      from public.epp_entrega_items ei
      join public.epp_items i on i.id = ei.item_id
      where ei.entrega_id = p_entrega_id
        and i.es_descartable = false
      group by ei.item_id
  loop
    v_vida_util := v_item.vida_util;
    v_fecha_proxima := v_entrega.fecha_entrega + (v_vida_util || ' months')::interval;

    -- 0. T-119 LIFECYCLE: cerrar la planificacion activa previa del mismo
    --    (empleado,item) ANTES de insertar la nueva (el unique parcial
    --    uq_epp_planif_activa_empleado_item rechazaria 2 activas). Capturamos sus
    --    calendar_event_id para completar el evento + saltear sus reminders pending
    --    (sin spam de un vencimiento ya resuelto por la reentrega). NO dispara
    --    recurrencia: las chains se crean en TS (completeCalendarEventAction /
    --    parent_event_id), nunca por trigger; ademas epp_entrega.recurrence_months
    --    es NULL. completed_by queda NULL (cierre por proceso, no por humano).
    with cerradas as (
      update public.epp_planificaciones
         set estado = 'cumplida'
       where empleado_id = v_entrega.empleado_id
         and item_id = v_item.item_id
         and estado = 'activa'
      returning calendar_event_id
    )
    select array_agg(calendar_event_id) filter (where calendar_event_id is not null)
      into v_prev_event_ids
      from cerradas;

    if v_prev_event_ids is not null then
      update public.calendar_events
         set status = 'completed', completed_at = now()
       where id = any(v_prev_event_ids)
         and status = 'pending';
      update public.calendar_event_reminders
         set status = 'skipped'
       where event_id = any(v_prev_event_ids)
         and status = 'pending';
    end if;

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

    -- 2. Crear epp_planificaciones linkeada al calendar_event (unica activa del par).
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

-- SEGURIDAD: identico a T-100/T-114. revoke from public/anon/authenticated, grant
-- solo service_role (security definer bypassa RLS -> riesgo cross-tenant). Idempotente.
revoke execute on function public.gen_epp_planificaciones_y_calendar_for(uuid)
  from public, anon, authenticated;
grant execute on function public.gen_epp_planificaciones_y_calendar_for(uuid) to service_role;

comment on function public.gen_epp_planificaciones_y_calendar_for(uuid) is
  'T-100/T-114/T-119: post-entrega EPP. Por cada item NO descartable (dedup por '
  'item_id) cierra la planificacion activa previa del mismo (empleado,item) '
  '(estado=cumplida + evento completed + reminders skipped, completed_by NULL) y '
  'genera la nueva epp_planificaciones + calendar_events (tipo=epp_entrega, offsets '
  '[14,3,0]) + reminders (12:00 UTC, omite pasado). Invariante: <=1 activa por '
  '(empleado,item), backstop en uq_epp_planif_activa_empleado_item. SOLO '
  'service_role: security definer bypassa RLS (riesgo cross-tenant).';

-- =============================================================================
-- BACKFILL T-119: colapsa los duplicados activos ya acumulados en prod. Por cada
-- (empleado_id, item_id) con >1 activa conserva la de fecha_proxima_entrega mas
-- reciente (empate: created_at mas reciente) y cierra el resto (cumplida + evento
-- completed + reminders skipped). Idempotente: en re-run no quedan duplicados
-- activos -> v_loser_ids NULL -> early return con notice 0.
-- Scope cross-tenant implicito: (empleado_id,item_id) no cruza consultoras (un
-- empleado pertenece a una sola) -> no hace falta consultora_id en el partition.
-- =============================================================================
do $$
declare
  v_loser_ids       uuid[];
  v_loser_event_ids uuid[];
  v_planif          int := 0;
  v_eventos         int := 0;
begin
  select array_agg(id),
         array_agg(calendar_event_id) filter (where calendar_event_id is not null)
    into v_loser_ids, v_loser_event_ids
    from (
      select id, calendar_event_id,
             row_number() over (
               partition by empleado_id, item_id
               order by fecha_proxima_entrega desc, created_at desc
             ) as rn
        from public.epp_planificaciones
       where estado = 'activa'
    ) ranked
   where ranked.rn > 1;

  if v_loser_ids is null then
    raise notice 'T-119 backfill: 0 planificaciones cerradas (sin duplicados activos)';
    return;
  end if;

  update public.epp_planificaciones
     set estado = 'cumplida'
   where id = any(v_loser_ids);
  get diagnostics v_planif = row_count;

  if v_loser_event_ids is not null then
    update public.calendar_events
       set status = 'completed', completed_at = now()
     where id = any(v_loser_event_ids)
       and status = 'pending';
    get diagnostics v_eventos = row_count;

    update public.calendar_event_reminders
       set status = 'skipped'
     where event_id = any(v_loser_event_ids)
       and status = 'pending';
  end if;

  raise notice 'T-119 backfill: % planificaciones cerradas, % eventos completados', v_planif, v_eventos;
end $$;

-- =============================================================================
-- T-119 INVARIANTE: a lo sumo 1 planificacion activa por (empleado_id, item_id).
-- Va AL FINAL: fallaria si corriera antes del backfill (duplicados pre-existentes).
-- No colisiona con idx_epp_planificaciones_proxima_activa (otras columnas, no-unico).
-- =============================================================================
create unique index if not exists uq_epp_planif_activa_empleado_item
  on public.epp_planificaciones (empleado_id, item_id)
  where estado = 'activa';

comment on index public.uq_epp_planif_activa_empleado_item is
  'T-119: bloquea 2 planificaciones EPP activas simultaneas para el mismo '
  '(empleado, item). La RPC gen_epp_planificaciones_y_calendar_for cierra la '
  'previa antes de insertar; este indice es el backstop a nivel DB.';
