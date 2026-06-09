-- T-129 (fase A) · Backfill best-effort de empleados_puestos desde la columna
-- legacy empleados.puesto (texto). Idempotente: por cada empleado con puesto
-- texto y SIN asignacion en el catalogo, busca (case-insensitive, activos) o crea
-- el puesto en su consultora (nombre truncado a 80) y lo asigna. Los no-procesables
-- se cuentan en skipped + errores (no rompen).
--
-- La columna empleados.puesto NO se dropea en esta fase (el puente de T-128 la
-- sigue escribiendo). El drop de la columna + de esta funcion va en T-129 fase B
-- (segundo PR del mismo ticket), post-deploy de esta fase.
--
-- p_consultora_id: NULL (default) procesa TODAS las consultoras (uso del deploy);
-- pasar un id lo acota a una sola consultora (re-run dirigido + aislamiento de tests).

create or replace function public.backfill_empleados_puestos_from_legacy(
  p_consultora_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp       record;
  v_owner     uuid;
  v_nombre    text;
  v_puesto_id uuid;
  v_new       boolean;
  v_created   int := 0;
  v_assigned  int := 0;
  v_skipped   int := 0;
  v_errors    jsonb := '[]'::jsonb;
begin
  for v_emp in
    select e.id, e.consultora_id, btrim(e.puesto) as puesto_txt
    from public.empleados e
    where e.puesto is not null
      and char_length(btrim(e.puesto)) >= 2
      and (p_consultora_id is null or e.consultora_id = p_consultora_id)
      and not exists (
        select 1 from public.empleados_puestos ep where ep.empleado_id = e.id
      )
  loop
    -- Subtransaccion por empleado: un error revierte SOLO esta fila (incluido el
    -- puesto recien creado si fallara el assign) y el loop sigue (best-effort).
    begin
      v_nombre := left(v_emp.puesto_txt, 80);
      v_new := false;

      -- Owner de la consultora para created_by / asignado_por (NULL si no hay).
      -- SELECT INTO sin STRICT + limit 1 tolera 0/N owners.
      select user_id into v_owner
        from public.consultora_members
        where consultora_id = v_emp.consultora_id and role = 'owner'
        order by user_id
        limit 1;

      -- Reuso case-insensitive sobre puestos VIGENTES de la misma consultora.
      select id into v_puesto_id
        from public.puestos
        where consultora_id = v_emp.consultora_id
          and archived_at is null
          and lower(nombre) = lower(v_nombre)
        order by created_at asc
        limit 1;

      if v_puesto_id is null then
        insert into public.puestos (consultora_id, nombre, created_by)
          values (v_emp.consultora_id, v_nombre, v_owner)
          returning id into v_puesto_id;
        v_new := true;
      end if;

      insert into public.empleados_puestos (empleado_id, puesto_id, consultora_id, asignado_por)
        values (v_emp.id, v_puesto_id, v_emp.consultora_id, v_owner)
        on conflict (empleado_id, puesto_id) do nothing;

      -- Contadores DESPUES de ambos inserts: si el assign fallara, el savepoint
      -- revierte el puesto creado y caemos al EXCEPTION sin contar de mas.
      if v_new then v_created := v_created + 1; end if;
      v_assigned := v_assigned + 1;
    exception when others then
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object(
        'empleado_id', v_emp.id,
        'puesto_txt', v_emp.puesto_txt,
        'sqlerrm', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'puestos_creados', v_created,
    'asignaciones', v_assigned,
    'skipped', v_skipped,
    'errores', v_errors);
end;
$$;

comment on function public.backfill_empleados_puestos_from_legacy(uuid) is
  'T-129 (fase A): backfill TRANSITORIO idempotente best-effort. Por cada empleado '
  'con empleados.puesto texto y SIN asignacion en empleados_puestos, busca '
  '(case-insensitive, activos) o crea el puesto del catalogo (truncado a 80) en su '
  'consultora y lo asigna. p_consultora_id NULL = todas; un id la acota. '
  'No-procesables -> skipped+errores (no rompe). SOLO service_role (security '
  'definer bypassa RLS; escribe SIEMPRE dentro del consultora_id del propio '
  'empleado, nunca cross-tenant). Se DROPEA en T-129 fase B (segundo PR del mismo '
  'ticket), junto con la columna empleados.puesto.';

revoke execute on function public.backfill_empleados_puestos_from_legacy(uuid) from public, anon, authenticated;
grant execute on function public.backfill_empleados_puestos_from_legacy(uuid) to service_role;

-- Ejecucion one-shot en el deploy (todas las consultoras). Reporta counts al log.
do $$
declare
  v_res jsonb;
begin
  v_res := public.backfill_empleados_puestos_from_legacy();
  raise notice 'T-129 backfill empleados_puestos: %', v_res;
end $$;
