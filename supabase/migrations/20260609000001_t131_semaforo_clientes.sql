-- T-131 (fase B) · Semaforo por cliente para el dashboard.
--
-- Por cada cliente del tenant del caller con >=1 vencimiento pending derivable:
-- su PEOR estado, fecha mas proxima y counts por bucket. Clientes sin
-- vencimientos NO aparecen aca (el server los completa 'al_dia' mergeando con
-- getClientesForConsultora -> fuente de verdad de "que clientes existen").
--
-- Derivacion evento->cliente (3 caminos; calibracion/examen_medico/custom sin
-- link -> excluidos, siguen en la cola de atencion de fase A, no se pierden):
--   1) informes:          ce.informe_id -> informes.cliente_id (NULLABLE -> INNER JOIN filtra)
--   2) epp_entrega:       ce.metadata->>'empleado_id' -> empleados.cliente_id
--   3) accion_correctiva: ce.metadata->>'cliente_id' directo (lo escribe gen_acciones_calendar_for, T-057)
--
-- Tenancy: security definer BYPASSA la RLS -> `consultora_id in (select my_consultora_ids())`
-- es la UNICA frontera, en CADA rama del UNION (patron de checks explicitos de T-075).
-- auth.uid() resuelve al CALLER aunque sea security definer (lee el GUC del JWT del request),
-- asi que my_consultora_ids() devuelve las consultoras del caller, no del owner de la funcion.
--
-- Cast seguro de metadata (paths 2 y 3): `metadata` es shape libre (un usuario puede
-- crear un epp_entrega/accion_correctiva manual con metadata basura). El cast a uuid
-- de un valor mal formado revienta la RPC ENTERA (invalid input syntax for type uuid)
-- -> tumbaria el semaforo del tenant. El guard regex de formato UUID en el WHERE
-- (predicado de una sola tabla -> Postgres lo empuja al scan de calendar_events, antes
-- del join/proyeccion que castea) excluye SOLO el evento basura: degradado granular.
--
-- p_hoy: el dashboard pasa SIEMPRE todayCivilIsoAR() (fuente unica JS, T-085), asi que
-- todo el tablero queda coherente sobre un unico "hoy". El default SQL
-- (now() at time zone 'America/Argentina/Buenos_Aires')::date es fallback/tests y NUNCA
-- usa CURRENT_DATE/UTC: en la ventana 21-24h ART, CURRENT_DATE adelanta un dia y un
-- vencimiento "de hoy (AR)" contaria como vencido. Buckets: vencido=f<hoy;
-- por_vencer=hoy<=f<=hoy+30; al_dia=f>hoy+30. "vence hoy" es por_vencer (igual que
-- dashboard/queries.ts: la severidad de la cola de atencion).

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
    select inf.cliente_id as cli, ce.fecha_vencimiento as f
      from public.calendar_events ce
      join public.informes inf on inf.id = ce.informe_id
     where ce.status = 'pending'
       and ce.consultora_id in (select public.my_consultora_ids())

    union all

    -- 2) EPP -> empleado -> cliente. Regex UUID antes del cast del join (ver cabecera).
    select emp.cliente_id as cli, ce.fecha_vencimiento as f
      from public.calendar_events ce
      join public.empleados emp on emp.id = (ce.metadata->>'empleado_id')::uuid
     where ce.tipo = 'epp_entrega'
       and ce.status = 'pending'
       and ce.metadata ? 'empleado_id'
       and ce.metadata->>'empleado_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and ce.consultora_id in (select public.my_consultora_ids())

    union all

    -- 3) Accion correctiva -> cliente_id directo. Regex UUID antes del cast del select.
    select (ce.metadata->>'cliente_id')::uuid as cli, ce.fecha_vencimiento as f
      from public.calendar_events ce
     where ce.tipo = 'accion_correctiva'
       and ce.status = 'pending'
       and ce.metadata ? 'cliente_id'
       and ce.metadata->>'cliente_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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
  'T-131 fase B: estado de semaforo (vencido/por_vencer/al_dia) por cliente del '
  'tenant, derivado de calendar_events pending por 3 caminos (informes/epp/accion). '
  'Tenancy via my_consultora_ids() (security definer bypassa RLS). Cast de metadata '
  'guardado por regex UUID (degrada el evento basura, no la RPC). El dashboard pasa '
  'todayCivilIsoAR(). Clientes sin vencimientos NO aparecen (server los completa al_dia).';

revoke all on function public.semaforo_clientes(date) from public, anon;
grant execute on function public.semaforo_clientes(date) to authenticated, service_role;
