-- =============================================================================
-- T-147 · RAR Fase 3b — el vencimiento RAR pinta el semáforo del cliente
-- =============================================================================
-- `semaforo_clientes(...)` derivaba el estado (vencido/por_vencer/al_dia) de tres
-- caminos de `calendar_events` pending: informes, EPP y acción correctiva. El
-- vencimiento anual del RAR (`tipo = 'rar_anual'`, creado por
-- gen_rar_vencimiento_calendar_for en T-146) quedaba afuera → un RAR vencido NO
-- pintaba al cliente en el dashboard.
--
-- Esta migración agrega una 4ª rama `union all` calcada de `accion_correctiva`:
-- el cliente sale directo de `metadata->>'cliente_id'`, con el cast `::uuid`
-- envuelto en CASE + regex UUID (plan-independiente, R2) y la tenancy validada en
-- AMBOS lados (ce.consultora_id Y cli.consultora_id con my_consultora_ids()).
--
-- FIRMA IDÉNTICA a la versión T-133: mismos params + mismo RETURNS TABLE → la
-- entrada `semaforo_clientes` de types.ts NO cambia (sin drift). Las 3 ramas
-- previas se copian tal cual; solo se suma la 4ª.
-- =============================================================================

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

    union all

    -- 4) RAR anual -> cliente directo (T-147). Molde idéntico a accion_correctiva:
    --    metadata.cliente_id la setea gen_rar_vencimiento_calendar_for (T-146) al
    --    crear el evento `rar_anual`. CASE+regex UUID = plan-independiente (R2);
    --    tenant validado en AMBOS lados.
    select cli.id as cli, ce.fecha_vencimiento as f
      from public.calendar_events ce
      join public.clientes cli
        on cli.id = (case
                       when ce.metadata->>'cliente_id'
                            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then (ce.metadata->>'cliente_id')::uuid
                     end)
       and cli.consultora_id in (select public.my_consultora_ids())
     where ce.tipo = 'rar_anual'
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
  'T-131 fase B + T-133 (L-1) + T-147: estado de semaforo (vencido/por_vencer/al_dia) por '
  'cliente del tenant, derivado de calendar_events pending por 4 caminos '
  '(informes/epp/accion/rar_anual). Tenancy en AMBOS lados: ce.consultora_id Y el '
  'cliente/empleado DERIVADO se validan con my_consultora_ids() — una referencia forjada '
  'degrada SOLO ese evento, igual que el guard regex UUID (cast envuelto en CASE: '
  'plan-independiente). NO filtra clientes archivados (lo hace el merge del dashboard). '
  'El dashboard pasa todayCivilIsoAR().';

revoke all on function public.semaforo_clientes(date) from public, anon;
grant execute on function public.semaforo_clientes(date) to authenticated, service_role;
