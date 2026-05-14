-- T-027 · Modulo Calendario (Sprint 3) — schema base.
--
-- Tablas: calendar_events + calendar_event_reminders.
-- Sin server actions ni UI (vienen en T-028 y T-029).
-- Sin cron / pg_cron / pg_net (viene en T-031).
--
-- Decisiones vs discovery (docs/discovery/07-calendario-notificaciones.md):
-- - FKs a clientes / empleados omitidas: esas tablas todavia no existen
--   (la migration que las cree agregara las columnas + FK + indexes).
-- - Status enum sin 'snoozed' (DA-04: NO snooze en MVP, se postergan
--   via UPDATE fecha_vencimiento real).
-- - Action de audit_log usa los verbos canonicos 'created'/'updated'/
--   'deleted' (patron T-019/T-024); el entity_type discrimina.
-- - tipo via CHECK + text (patron informes.tipo, kind de attachments).
-- - reminder_offsets_days SIN default SQL: server action (T-028) inyecta
--   el array correcto segun tipo (los defaults viven en codigo TS, varian
--   por tipo: RGRL [60,30,7,0], EPP [14,3,0], etc.).
--
-- RLS: helpers T-015 (is_member_of_consultora, is_owner_of_consultora).
-- - calendar_events: SELECT any member, INSERT auto-attrib, UPDATE creator
--   OR owner, DELETE sin policy (default-deny -> UI usa status='cancelled').
-- - calendar_event_reminders: SELECT any member (transparencia para el
--   user de "que voy a recibir"). INSERT/UPDATE/DELETE sin policy: son
--   filas operacionales, T-028 las crea via service-role, T-031 las marca
--   via service-role. Si abrieramos INSERT a authenticated, un user podria
--   programar scheduled_at arbitrario o duplicar reminders.

-- =====================================================================
-- Tabla calendar_events
-- =====================================================================

-- tipo enum values (discovery seccion 4):
--   protocolo_anual: protocolos tecnicos individuales (ruido Res 85/12,
--                    iluminacion Res 84/12, puesta a tierra, carga de
--                    fuego). N por cliente (uno por agente medido).
--                    Reminders default [30, 7, 0].
--   rgrl_anual:      presentacion anual RGRL ante ART (Res SRT 463/09).
--                    1 por cliente/anio, documento agregado.
--                    Reminders default [60, 30, 7, 0].
--   epp_entrega:     renovacion EPP por empleado (Res SRT 299/11), 6 meses.
--                    Reminders default [14, 3, 0].
--   capacitacion:    capacitacion EPP / trabajo en altura / primeros
--                    auxilios, 12 meses default. Reminders [30, 7, 0].
--   calibracion:     sonometro / luxometro / telurometro / anemometro,
--                    12 meses. Reminders [60, 14, 0].
--   examen_medico:   examen periodico ART por empleado, 12 meses.
--                    Reminders [30, 7, 0].
--   custom:          vencimiento custom del consultor, one-off por
--                    default. Reminders [7, 0].
create table public.calendar_events (
  id                     uuid primary key default gen_random_uuid(),
  consultora_id          uuid not null references public.consultoras(id) on delete cascade,
  tipo                   text not null
                         check (tipo in (
                           'protocolo_anual', 'epp_entrega', 'capacitacion',
                           'calibracion', 'examen_medico', 'rgrl_anual', 'custom'
                         )),
  titulo                 text not null check (length(trim(titulo)) between 3 and 200),
  descripcion            text check (descripcion is null or length(descripcion) <= 2000),
  informe_id             uuid references public.informes(id) on delete set null,
  fecha_vencimiento      date not null,
  recurrence_months      int check (recurrence_months is null or recurrence_months between 1 and 60),
  status                 text not null default 'pending'
                         check (status in ('pending', 'completed', 'cancelled')),
  completed_at           timestamptz,
  completed_by           uuid references auth.users(id) on delete set null,
  reminder_offsets_days  int[] not null,
  metadata               jsonb check (metadata is null or pg_column_size(metadata) <= 4096),
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Index principal: query del calendario "proximos vencimientos pendientes"
-- en una consultora ordenados por fecha. Partial WHERE status='pending'
-- mantiene el indice chico (completed/cancelled no estan en este caso de uso).
create index idx_calevents_consultora_fecha
  on public.calendar_events(consultora_id, fecha_vencimiento)
  where status = 'pending';

-- Lookup "evento que origino este informe" (T-036 modal post-firma).
create index idx_calevents_informe
  on public.calendar_events(informe_id) where informe_id is not null;

-- Trigger updated_at: reusa public.set_updated_at() de T-011. Defensa en
-- profundidad: cualquier UPDATE (server action, RPC futura, service-role
-- manual) garantiza updated_at correcto.
create trigger set_updated_at_calendar_events
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Tabla calendar_event_reminders
-- =====================================================================

-- consultora_id denormalizado deliberadamente: RLS fast-path sin join
-- al parent event. Mismo trade-off que T-024 informe_attachments.
-- UNIQUE (event_id, offset_days): capa DB del idempotence stack del
-- discovery seccion 7.4 (previene dups si T-028 reintenta crear).
create table public.calendar_event_reminders (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.calendar_events(id) on delete cascade,
  consultora_id  uuid not null references public.consultoras(id) on delete cascade,
  offset_days    int not null check (offset_days >= 0 and offset_days <= 365),
  scheduled_at   timestamptz not null,
  status         text not null default 'pending'
                 check (status in ('pending', 'sent', 'skipped', 'failed')),
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  unique (event_id, offset_days)
);

-- Index principal del cron (T-031): "reminders due cuyo status sigue pending".
create index idx_reminders_due
  on public.calendar_event_reminders(scheduled_at)
  where status = 'pending';

-- Lookup "reminders de este event" (UPDATE fecha -> recalc reminders).
create index idx_reminders_event
  on public.calendar_event_reminders(event_id);

-- =====================================================================
-- Audit trigger calendar_events
-- =====================================================================

-- Diff guard sobre campos mutables: titulo, tipo, status,
-- fecha_vencimiento, recurrence_months, descripcion, completed_at.
-- Excluidos del guard (ruido o inmutables): metadata, reminder_offsets_days,
-- created_by, consultora_id, id.
--
-- descripcion va al diff guard pero NO al payload de before/after (puede
-- pesar hasta 2 KB; el row de audit_log se mantiene compacto).
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
         'informe_id', new.informe_id
       ));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.titulo, new.tipo, new.status, new.fecha_vencimiento,
        new.recurrence_months, new.descripcion, new.completed_at)
       is distinct from
       (old.titulo, old.tipo, old.status, old.fecha_vencimiento,
        old.recurrence_months, old.descripcion, old.completed_at) then
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
           'completed_at', old.completed_at
         ),
         jsonb_build_object(
           'titulo', new.titulo,
           'tipo', new.tipo,
           'status', new.status,
           'fecha_vencimiento', new.fecha_vencimiento,
           'recurrence_months', new.recurrence_months,
           'completed_at', new.completed_at
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
         'fecha_vencimiento', old.fecha_vencimiento
       ),
       null);
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_calendar_events_after_insert
  after insert on public.calendar_events
  for each row execute function public.audit_calendar_events();

create trigger audit_calendar_events_after_update
  after update on public.calendar_events
  for each row execute function public.audit_calendar_events();

create trigger audit_calendar_events_after_delete
  after delete on public.calendar_events
  for each row execute function public.audit_calendar_events();

-- =====================================================================
-- RLS calendar_events
-- =====================================================================

alter table public.calendar_events enable row level security;

-- SELECT: cualquier member de la consultora ve los eventos.
create policy calendar_events_select_own on public.calendar_events
  for select using (
    public.is_member_of_consultora(consultora_id)
  );

-- INSERT: member de la consultora, auto-atribuido (no usurpa identidad).
create policy calendar_events_insert_own on public.calendar_events
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );

-- UPDATE: creator del evento O owner de la consultora.
create policy calendar_events_update_own_or_owner on public.calendar_events
  for update
  using (
    public.is_member_of_consultora(consultora_id)
    and (
      created_by = auth.uid()
      or public.is_owner_of_consultora(consultora_id)
    )
  )
  with check (
    public.is_member_of_consultora(consultora_id)
    and (
      created_by = auth.uid()
      or public.is_owner_of_consultora(consultora_id)
    )
  );

-- DELETE: SIN policy. Default-deny para authenticated.
-- Soft-delete UX = UPDATE status='cancelled'.
-- Hard-delete solo via service-role (cleanup admin / cascade desde
-- consultoras).

-- =====================================================================
-- RLS calendar_event_reminders
-- =====================================================================

alter table public.calendar_event_reminders enable row level security;

-- SELECT: member de la consultora ve los reminders (transparencia: "que
-- voy a recibir y cuando").
create policy calendar_event_reminders_select_own on public.calendar_event_reminders
  for select using (
    public.is_member_of_consultora(consultora_id)
  );

-- INSERT/UPDATE/DELETE: SIN policies para authenticated. Service-role only.
-- - T-028 server action crea reminders junto al event (service-role).
-- - T-031 cron marca status sent/skipped/failed (service-role).
-- - UPDATE de event.fecha_vencimiento recalcula reminders (service-role).
