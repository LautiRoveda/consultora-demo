-- T-146 · RAR Fase 3a — Registro de presentación + vencimiento anual en calendario.
--
-- Cierra el pilar 2 del producto para RAR ("te aviso antes de que venza"). Suma:
--   1. `rar_presentaciones` (registro INMUTABLE con snapshot legal jsonb).
--   2. `rar_anual`: nuevo tipo de calendar_event SYSTEM-GENERATED (lo crea la RPC
--      service-role; recurrence_months NULL — el próximo vencimiento nace de la
--      próxima presentación, NO de la auto-recurrencia). Molde epp_entrega.
--   3. RPC `gen_rar_vencimiento_calendar_for`: cierra el rar_anual pending anterior
--      del cliente (lifecycle, molde T-119) → el trigger T-123 le skipea los
--      reminders pending; crea el nuevo evento + reminders ([60,30,7,0]); inserta
--      la presentación.
--
-- Decisiones cerradas (orquestador, ADR-0016):
--   - rar_anual system-generated (policy INSERT lo bloquea para authenticated; el
--     trigger T-133 le congela tipo/metadata/recurrence). Espejo de
--     SYSTEM_GENERATED_EVENT_TIPOS (calendario/defaults.ts) — guard t133 test.
--   - rar_presentaciones inmutable: SELECT member, SIN INSERT/UPDATE/DELETE policy
--     (lo crea la RPC service-role, que bypassa RLS). Snapshot = fuente legal.
--   - fecha_vencimiento configurable (el RAR vence con el contrato ART, no a +12m
--     fijos). La action default a fecha_presentacion + 12 meses.
--   - PDF NO se persiste (snapshot es la fuente; descarga histórica = Fase 3b).
--
-- Aditiva + redefiniciones (no destructiva): agrega un valor al CHECK (no rompe
-- filas existentes), redefine policy/trigger (CREATE OR REPLACE / DROP+CREATE) y
-- crea tabla + RPC nuevas.

-- =============================================================================
-- A. calendar_events.tipo += 'rar_anual'
-- =============================================================================

-- A.1 · CHECK constraint (molde t057 / t133): drop + re-add con rar_anual sumado.
alter table public.calendar_events drop constraint calendar_events_tipo_check;
alter table public.calendar_events add constraint calendar_events_tipo_check
  check (tipo in (
    'protocolo_anual', 'epp_entrega', 'capacitacion', 'calibracion',
    'examen_medico', 'rgrl_anual', 'custom', 'accion_correctiva', 'rar_anual'
  ));

-- A.2 · Policy INSERT (molde t133): rar_anual al `not in` (bloquea alta manual de
-- tipos system para authenticated; la RPC service-role bypassa RLS).
drop policy calendar_events_insert_own on public.calendar_events;
create policy calendar_events_insert_own on public.calendar_events
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
    and tipo not in ('epp_entrega', 'accion_correctiva', 'rar_anual')
  );

-- A.3 · Trigger guard (molde t133): rar_anual al `old.tipo in (...)` — freeze de
-- metadata/recurrence_months en filas system para authenticated. Cuerpo idéntico
-- al t133; solo cambia la lista. El freeze de `tipo` sigue siendo global.
create or replace function public.calendar_events_guard_system_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tipo is distinct from old.tipo then
    raise exception 'calendar_events.tipo es inmutable (T-133)';
  end if;

  if coalesce(auth.role(), '') = 'authenticated'
     and old.tipo in ('epp_entrega', 'accion_correctiva', 'rar_anual') then
    if new.recurrence_months is not null
       and new.recurrence_months is distinct from old.recurrence_months then
      raise exception 'recurrence_months no editable en eventos del sistema (T-133)';
    end if;
    if (new.metadata - 'cancel_reason') is distinct from (old.metadata - 'cancel_reason') then
      raise exception 'metadata no editable en eventos del sistema (T-133)';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.calendar_events_guard_system_rows() is
  'T-133/T-146: freeze de tipo (global, todos los roles) + de metadata/recurrence_months '
  'en filas system-generated (epp_entrega/accion_correctiva/rar_anual) para authenticated '
  '(carve-out cancel_reason). Lista en sync con SYSTEM_GENERATED_EVENT_TIPOS (calendario/defaults.ts).';

-- =============================================================================
-- B. TABLA rar_presentaciones (Ring A, INMUTABLE)
-- =============================================================================

-- Registro legal de cada presentación del RAR a la ART. Inmutable: la única
-- mutación posible es el INSERT (vía RPC service-role). El snapshot jsonb congela
-- el header del cliente + la nómina (NTE/DAR) al momento de presentar — fuente de
-- verdad para la descarga histórica (Fase 3b). FK compuestas Ring A (ADR-0015):
-- cliente y calendar_event deben pertenecer a la misma consultora que la fila.
create table public.rar_presentaciones (
  id                 uuid primary key default gen_random_uuid(),
  consultora_id      uuid not null references public.consultoras(id) on delete cascade,
  cliente_id         uuid not null,
  periodo            int  not null check (periodo between 2000 and 2100),
  fecha_presentacion date not null default current_date,
  fecha_vencimiento  date not null,
  snapshot           jsonb not null,          -- cliente header + nómina (NTE/DAR) congelada
  calendar_event_id  uuid,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint rar_presentaciones_id_consultora_id_key unique (id, consultora_id),
  constraint rar_pres_cliente_consultora_fkey
    foreign key (cliente_id, consultora_id) references public.clientes(id, consultora_id) on delete cascade,
  constraint rar_pres_calevent_consultora_fkey
    foreign key (calendar_event_id, consultora_id) references public.calendar_events(id, consultora_id) on delete set null,
  unique (consultora_id, cliente_id, periodo)
);

comment on table public.rar_presentaciones is
  'T-146: registro INMUTABLE de presentaciones del RAR a la ART. Una por '
  '(consultora, cliente, periodo). snapshot jsonb = header del cliente + nómina '
  'NTE/DAR congelada (fuente legal). Lo crea la RPC gen_rar_vencimiento_calendar_for '
  '(service-role); SIN policy INSERT/UPDATE/DELETE. FK compuestas Ring A.';

comment on column public.rar_presentaciones.snapshot is
  'T-146: foto congelada al presentar — {cliente:{razon_social,cuit,art,...}, '
  'nomina:{expuestos,agentes}, generado_at}. Sin cap de tamaño (la nómina puede '
  'ser grande; el cap de 4096 es del metadata de calendar_events, no de acá).';

create index idx_rar_presentaciones_cliente
  on public.rar_presentaciones(consultora_id, cliente_id);

-- =============================================================================
-- C. AUDIT TRIGGER (tabla inmutable → solo INSERT)
-- =============================================================================

-- Registro legal: queremos saber QUIÉN presentó. La RPC corre con service-role
-- (auth.uid() null) pero pasa el actor en new.created_by → coalesce lo usa.
create or replace function public.audit_rar_presentaciones()
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
      (new.consultora_id, coalesce(auth.uid(), new.created_by), 'created', 'rar_presentaciones',
       new.id, null,
       jsonb_build_object('cliente_id', new.cliente_id, 'periodo', new.periodo,
                          'fecha_presentacion', new.fecha_presentacion,
                          'fecha_vencimiento', new.fecha_vencimiento,
                          'calendar_event_id', new.calendar_event_id));
    return new;
  end if;
  -- UPDATE/DELETE imposibles (tabla inmutable, sin policy) → no auditados.
  return null;
end;
$$;

create trigger audit_rar_presentaciones_after_insert
  after insert on public.rar_presentaciones
  for each row execute function public.audit_rar_presentaciones();

-- =============================================================================
-- D. RLS (helpers T-015: is_member_of_consultora)
-- =============================================================================

-- INMUTABLE: SELECT member; SIN INSERT/UPDATE/DELETE (lo crea la RPC service-role).
alter table public.rar_presentaciones enable row level security;

create policy rar_presentaciones_select_own on public.rar_presentaciones
  for select using (public.is_member_of_consultora(consultora_id));

-- =============================================================================
-- E. RPC gen_rar_vencimiento_calendar_for (service-role)
-- =============================================================================

-- Orden: (1) cerrar el rar_anual pending anterior del cliente (lifecycle, molde
-- T-119; el UPDATE→completed dispara T-123 que skipea sus reminders pending);
-- (2) crear el calendar_event rar_anual (recurrence NULL) + reminders [60,30,7,0]
-- (molde t114:90-98, 12:00 UTC, omite pasados); (3) insertar la presentación.
-- Devuelve el id de la presentación. El unique (consultora,cliente,periodo) levanta
-- 23505 acá si el período ya fue presentado → la action lo mapea a DUPLICATE.
create or replace function public.gen_rar_vencimiento_calendar_for(
  p_consultora_id      uuid,
  p_cliente_id         uuid,
  p_periodo            int,
  p_fecha_presentacion date,
  p_fecha_vencimiento  date,
  p_snapshot           jsonb,
  p_created_by         uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id  uuid;
  v_pres_id   uuid;
  v_titulo    text;
  v_offsets   int[] := array[60, 30, 7, 0];  -- cadencia RAR (legal-crítico, molde RGRL)
  v_offset    int;
  v_scheduled timestamptz;
begin
  -- 1. Cierre de ciclo: cerrar TODOS los rar_anual pending del cliente (set-based
  --    → robusto si hubiera 2 por un bug previo). metadata->> da text → cast.
  update public.calendar_events
     set status = 'completed', completed_at = now()
   where consultora_id = p_consultora_id
     and tipo = 'rar_anual'
     and status = 'pending'
     and metadata->>'cliente_id' = p_cliente_id::text;

  -- 2. Nuevo calendar_event rar_anual. recurrence_months NULL (el próximo nace de
  --    la próxima presentación). titulo derivado del snapshot (CHECK 3-200 → left).
  v_titulo := left(
    'Vencimiento RAR — ' || coalesce(p_snapshot->'cliente'->>'razon_social', 'establecimiento'),
    200);

  insert into public.calendar_events (
    consultora_id, tipo, titulo, fecha_vencimiento,
    reminder_offsets_days, status, created_by, metadata
  ) values (
    p_consultora_id,
    'rar_anual',
    v_titulo,
    p_fecha_vencimiento,
    v_offsets,
    'pending',
    p_created_by,
    jsonb_build_object('cliente_id', p_cliente_id, 'source_module', 'rar')
  )
  returning id into v_event_id;

  -- 3. Reminders (molde t114): scheduled_at = (fecha_vencimiento - offset) a las
  --    12:00 UTC (= 09:00 ART). Omite los que cayeron en el pasado.
  foreach v_offset in array v_offsets loop
    v_scheduled := ((p_fecha_vencimiento - v_offset)::timestamp + interval '12 hours')
                   at time zone 'UTC';
    if v_scheduled >= now() then
      insert into public.calendar_event_reminders (event_id, consultora_id, offset_days, scheduled_at, status)
        values (v_event_id, p_consultora_id, v_offset, v_scheduled, 'pending')
        on conflict (event_id, offset_days) do nothing;
    end if;
  end loop;

  -- 4. Registro inmutable de la presentación (linkeado al evento). El unique
  --    (consultora,cliente,periodo) levanta 23505 si el período ya existe.
  insert into public.rar_presentaciones (
    consultora_id, cliente_id, periodo, fecha_presentacion, fecha_vencimiento,
    snapshot, calendar_event_id, created_by
  ) values (
    p_consultora_id, p_cliente_id, p_periodo, p_fecha_presentacion, p_fecha_vencimiento,
    p_snapshot, v_event_id, p_created_by
  )
  returning id into v_pres_id;

  return v_pres_id;
end;
$$;

-- SEGURIDAD (molde gen_epp / gen_acciones): security definer bypassa RLS → SOLO
-- service_role. revoke a public/anon/authenticated, grant a service_role.
revoke execute on function public.gen_rar_vencimiento_calendar_for(uuid, uuid, int, date, date, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.gen_rar_vencimiento_calendar_for(uuid, uuid, int, date, date, jsonb, uuid)
  to service_role;

comment on function public.gen_rar_vencimiento_calendar_for(uuid, uuid, int, date, date, jsonb, uuid) is
  'T-146: registra una presentación del RAR. Cierra el rar_anual pending anterior del '
  'cliente (lifecycle T-119 → skip reminders T-123), crea el calendar_event rar_anual '
  '(recurrence NULL, offsets [60,30,7,0]) + sus reminders, e inserta rar_presentaciones. '
  'Devuelve el id de la presentación. SOLO service_role (security definer bypassa RLS).';
