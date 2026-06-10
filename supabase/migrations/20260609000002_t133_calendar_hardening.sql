-- T-133 · Calendar hardening (auditoría de seguridad Opus 4.8: M-1 + L-1).
--
-- M-1a: la policy INSERT excluye los tipos system-generated para authenticated.
-- M-1b: trigger BEFORE UPDATE — `tipo` inmutable (global) + metadata/recurrencia
--       congeladas en filas system para authenticated (carve-out cancel_reason).
-- L-1:  semaforo_clientes re-valida que el cliente DERIVADO pertenezca al tenant
--       en cada rama (antes solo se scopeaba ce.consultora_id, el lado base).
--
-- La lista de tipos system-generated de la policy y el trigger es espejo de
-- SYSTEM_GENERATED_EVENT_TIPOS en src/app/(app)/calendario/defaults.ts —
-- mantener en sync (guard: src/tests/unit/t133-system-tipos-sql-sync.test.ts).

-- =============================================================================
-- M-1a · Policy INSERT: tipos system-generated bloqueados para authenticated
-- =============================================================================
-- Los inserts legítimos de epp_entrega / accion_correctiva vienen por las RPCs
-- gen_epp_planificaciones_y_calendar_for / gen_acciones_calendar_for (security
-- definer, EXECUTE solo service_role) → bypassean RLS, no se afectan. La
-- auto-recurrencia de completeCalendarEventAction (insert con client
-- authenticated que copia el tipo del evento original) solo clona tipos que ya
-- no pueden ser system: recurrence_months es NULL en los eventos system por
-- diseño (T-119) y el trigger de abajo impide setearla.
drop policy calendar_events_insert_own on public.calendar_events;
create policy calendar_events_insert_own on public.calendar_events
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
    and tipo not in ('epp_entrega', 'accion_correctiva')
  );

-- =============================================================================
-- M-1b · Trigger BEFORE UPDATE: freeze de tipo + metadata/recurrencia system
-- =============================================================================
-- PORQUÉ trigger y no policy: la WITH CHECK de UPDATE solo ve la fila NUEVA —
-- "tipo inmutable" (NEW vs OLD) no es expresable en RLS, y sin esto un PATCH
-- crudo a PostgREST puede convertir un evento custom en epp_entrega esquivando
-- la policy INSERT, o pisar la metadata de un evento system existente.
--
-- Detección de rol: auth.role() lee el claim del JWT del request →
-- 'authenticated' (token de usuario) aplica los checks de metadata/recurrencia;
-- 'service_role' (RPCs gen_*, T-118/T-119, clients admin) y NULL (SQL directo,
-- migraciones/backfills) pasan libres — los flujos system son confiables. El
-- freeze de `tipo` es GLOBAL (sin gate de rol): ningún flujo legítimo lo cambia
-- jamás, así también atrapa bugs de código service-role.
--
-- Carve-out cancel_reason: el motivo de cancelación NO tiene columna propia —
-- cancelCalendarEventAction lo mergea DENTRO de metadata y ejecuta el UPDATE
-- con el client del usuario (authenticated). `jsonb - 'cancel_reason'` sobre
-- NULL da NULL → IS DISTINCT FROM maneja bien los nulls. Abusar del carve-out
-- (PATCH directo de solo cancel_reason) es inocuo: campo display-only, no
-- alimenta derivación.
--
-- Compatible con la lección T-062 (triggers RAISE vs cascades): los UPDATEs de
-- ON DELETE SET NULL (informes→informe_id, users→created_by/completed_by) no
-- tocan tipo/metadata/recurrence → no disparan. Un RAISE aborta el statement
-- entero → los AFTER (audit, sync T-118, skip T-123) no corren, sin filas
-- huérfanas.
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
     and old.tipo in ('epp_entrega', 'accion_correctiva') then
    -- recurrence_months: NULL pasa (EventForm edit lo manda incondicionalmente
    -- con el checkbox apagado; des-setear recurrencia en una fila system
    -- pre-fix es remediación, no riesgo).
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
  'T-133: freeze de tipo (global, todos los roles) + de metadata/recurrence_months en filas '
  'system-generated para authenticated (carve-out cancel_reason: vive dentro de metadata y '
  'lo escribe el user-client al cancelar). La WITH CHECK de UPDATE no ve OLD → no expresable '
  'en RLS. Lista de tipos en sync con SYSTEM_GENERATED_EVENT_TIPOS (calendario/defaults.ts).';

create trigger guard_system_rows_calendar_events
  before update on public.calendar_events
  for each row execute function public.calendar_events_guard_system_rows();

-- =============================================================================
-- L-1 · semaforo_clientes: re-scope del lado derivado (CREATE OR REPLACE,
--       misma firma → sin drift de types.ts)
-- =============================================================================
-- Cada rama ya scopeaba ce.consultora_id (el lado base); ahora el id DERIVADO
-- también se valida contra el tenant: un informe_id / empleado_id / cliente_id
-- forjado (cross-tenant o inexistente) degrada SOLO ese evento, igual que el
-- guard regex UUID de T-131.
--
-- R2 · Cast plan-independiente: el ::uuid de metadata va envuelto en
-- CASE WHEN <regex> — CASE garantiza el orden de evaluación por fila, sin
-- depender del push-down del predicado (la versión T-131 tenía el regex en el
-- WHERE y el cast en el JOIN: correcto en la práctica, pero dependiente del
-- plan). Metadata basura produce NULL → el join descarta el evento (degradado
-- granular intacto, la RPC no revienta).
create or replace function public.semaforo_clientes(p_hoy date default null)
returns table (
  cliente_id      uuid,
  estado          text,
  fecha_proxima   date,
  vencidos_count  integer,
  proximos_count  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoy date := coalesce(p_hoy, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
begin
  return query
  with pendientes as (
    -- 1) Informes (cliente_id NULLABLE -> INNER JOIN descarta los sin cliente).
    --    T-133: el join a clientes valida que el cliente derivado sea del tenant
    --    (un informe_id cross-tenant forjado ya no filtra nada). NO filtra
    --    archived_at: comportamiento pre-existente (el merge del dashboard con
    --    getClientesForConsultora descarta archivados).
    select cli.id as cli, ce.fecha_vencimiento as f
      from public.calendar_events ce
      join public.informes inf on inf.id = ce.informe_id
      join public.clientes cli
        on cli.id = inf.cliente_id
       and cli.consultora_id in (select public.my_consultora_ids())
     where ce.status = 'pending'
       and ce.consultora_id in (select public.my_consultora_ids())

    union all

    -- 2) EPP -> empleado -> cliente. T-133: emp.consultora_id del tenant (un
    --    empleado_id ajeno forjado en metadata ya no filtra su cliente).
    select emp.cliente_id as cli, ce.fecha_vencimiento as f
      from public.calendar_events ce
      join public.empleados emp
        on emp.id = (case
                       when ce.metadata->>'empleado_id'
                            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then (ce.metadata->>'empleado_id')::uuid
                     end)
       and emp.consultora_id in (select public.my_consultora_ids())
     where ce.tipo = 'epp_entrega'
       and ce.status = 'pending'
       and ce.metadata ? 'empleado_id'
       and ce.consultora_id in (select public.my_consultora_ids())

    union all

    -- 3) Accion correctiva -> cliente directo. T-133: el join a clientes valida
    --    existencia + tenant (antes el cliente_id de metadata salía sin validar).
    select cli.id as cli, ce.fecha_vencimiento as f
      from public.calendar_events ce
      join public.clientes cli
        on cli.id = (case
                       when ce.metadata->>'cliente_id'
                            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then (ce.metadata->>'cliente_id')::uuid
                     end)
       and cli.consultora_id in (select public.my_consultora_ids())
     where ce.tipo = 'accion_correctiva'
       and ce.status = 'pending'
       and ce.metadata ? 'cliente_id'
       and ce.consultora_id in (select public.my_consultora_ids())
  )
  select
    p.cli as cliente_id,
    case
      when bool_or(p.f < v_hoy)       then 'vencido'
      when bool_or(p.f <= v_hoy + 30) then 'por_vencer'
      else 'al_dia'
    end as estado,
    min(p.f) as fecha_proxima,
    count(*) filter (where p.f < v_hoy)::int                        as vencidos_count,
    count(*) filter (where p.f >= v_hoy and p.f <= v_hoy + 30)::int as proximos_count
  from pendientes p
  where p.cli is not null
  group by p.cli;
end;
$$;

comment on function public.semaforo_clientes(date) is
  'T-131 fase B + T-133 (L-1): estado de semaforo (vencido/por_vencer/al_dia) por cliente '
  'del tenant, derivado de calendar_events pending por 3 caminos (informes/epp/accion). '
  'Tenancy en AMBOS lados: ce.consultora_id Y el cliente/empleado DERIVADO se validan con '
  'my_consultora_ids() — una referencia forjada degrada SOLO ese evento, igual que el guard '
  'regex UUID (cast envuelto en CASE: plan-independiente). NO filtra clientes archivados '
  '(lo hace el merge del dashboard). El dashboard pasa todayCivilIsoAR().';

revoke all on function public.semaforo_clientes(date) from public, anon;
grant execute on function public.semaforo_clientes(date) to authenticated, service_role;
