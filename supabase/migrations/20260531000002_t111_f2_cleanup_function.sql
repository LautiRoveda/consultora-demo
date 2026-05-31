-- =============================================================================
-- T-111 · F2: función de cleanup de consultoras de TEST (TEMPORAL)
-- =============================================================================
-- Borra consultoras de test + TODAS sus tablas hijas en una transacción con
-- session_replication_role='replica' (desactiva FK/cascade/triggers, incluido el
-- inmutable de audit_log). Descubrimiento de hijas por FK-REACHABILITY recursiva
-- desde public.consultoras, así las tablas sin consultora_id (informe_metadata)
-- entran por construcción => cero huérfanos.
--
-- SECURITY DEFINER owned by postgres (necesario para set_config replica). Solo
-- ejecutable por service_role / postgres. Batched: el caller pasa lotes de ids
-- YA validados por el dry-run (la función borra exactamente lo que recibe).
--
-- TEMPORAL: se dropea con una migración de cierre post-cleanup (no queda arma
-- cargada en prod). Ver docs/sprints/operativo.md (T-111-F2).
-- =============================================================================

create or replace function public.admin_cleanup_test_consultoras(p_ids uuid[])
returns table (tabla text, filas_borradas bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_rows bigint;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;

  perform set_config('session_replication_role', 'replica', true);

  -- FASE A · hijas SIN consultora_id alcanzables transitivamente desde
  -- consultoras (ej. informe_metadata -> informes -> consultoras). Descubrimiento
  -- RECURSIVO por FK-reachability; cada fila se filtra por su cadena de FK hasta
  -- consultoras (pred anidado). Orden depth DESC: la más profunda primero, así
  -- sus padres aún existen cuando se evalúa el filtro.
  for r in
    with recursive reach as (
      select 'consultoras'::text as rel, 0 as depth,
             'id = any($1)'::text as pred,
             false as sin_cid
      union all
      select chld.relname::text, p.depth + 1,
             format('%I in (select id from public.%I where %s)',
                    fkcol.attname, p.rel, p.pred),
             not exists (select 1 from pg_attribute a
                         where a.attrelid = con.conrelid and a.attname = 'consultora_id'
                           and a.attnum > 0 and not a.attisdropped)
      from reach p
      join pg_class pc        on pc.relname = p.rel and pc.relnamespace = 'public'::regnamespace
      join pg_constraint con  on con.confrelid = pc.oid and con.contype = 'f'
      join pg_class chld      on chld.oid = con.conrelid and chld.relnamespace = 'public'::regnamespace
      join pg_attribute fkcol on fkcol.attrelid = con.conrelid and fkcol.attnum = con.conkey[1]
      where array_length(con.conkey, 1) = 1   -- FK de 1 columna
        and chld.relname <> p.rel             -- evita self-ref
        and p.depth < 10                      -- guard anti-ciclo
    ),
    dedup as (   -- por tabla, el camino más profundo (un solo DELETE)
      select distinct on (rel) rel, depth, pred
      from reach
      where sin_cid                            -- SOLO las sin consultora_id se borran acá
      order by rel, depth desc
    )
    select rel, pred from dedup order by depth desc   -- más profunda primero
  loop
    execute format('delete from public.%I where %s', r.rel, r.pred) using p_ids;
    get diagnostics v_rows = row_count;
    tabla := r.rel; filas_borradas := v_rows; return next;
  end loop;

  -- FASE B · todas las tablas con consultora_id (nivel-1, denormalizado).
  for r in
    select c.relname::text as rel
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
    where c.relkind = 'r' and c.relname <> 'consultoras'
      and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'consultora_id'
                    and a.attnum > 0 and not a.attisdropped)
  loop
    execute format('delete from public.%I where consultora_id = any($1)', r.rel) using p_ids;
    get diagnostics v_rows = row_count;
    tabla := r.rel; filas_borradas := v_rows; return next;
  end loop;

  -- FASE C · raíz.
  delete from public.consultoras where id = any(p_ids);
  get diagnostics v_rows = row_count;
  tabla := 'consultoras'; filas_borradas := v_rows; return next;
end;
$$;

comment on function public.admin_cleanup_test_consultoras(uuid[]) is
  'T-111-F2 (TEMPORAL): borra consultoras de test + hijas (FK-reachability recursiva) '
  'en una tx con session_replication_role=replica. SECURITY DEFINER owned by postgres. '
  'Dropear post-cleanup.';

-- Seguridad: NO ejecutable por usuarios logueados ni anon. Solo service_role
-- (test + cleanup vía RPC con service key) y el owner (postgres).
revoke execute on function public.admin_cleanup_test_consultoras(uuid[]) from public, authenticated, anon;
grant  execute on function public.admin_cleanup_test_consultoras(uuid[]) to service_role;
