-- T-059 · Reorder de secciones/ítems de un template draft — RPCs atómicas.
--
-- T-058 difirió el reorder. El editor (T-059) lo necesita: botones ↑/↓ que mandan
-- el ARRAY COMPLETO reordenado de ids y la RPC reasigna `orden` a 0..N-1.
--
-- POR QUÉ una RPC y no UPDATEs desde el client: uq_template_sections_version_orden
-- (version_id, orden) y uq_template_items_section_orden (section_id, orden) son
-- índices únicos NON-DEFERRABLE → un swap de 2 filas (o incluso un solo UPDATE
-- multi-fila) colisiona a mitad. La RPC corre en UNA transacción y usa el truco
-- TWO-PHASE: fase 1 bumpea todas las filas del scope fuera del rango destino
-- (orden + 1000000), fase 2 asigna 0..N-1 desde el array. Ningún estado intermedio
-- duplica (version_id|section_id, orden).
--
-- Patrón = clone RPCs T-058: SECURITY DEFINER + set search_path='' + fully-qualified
-- + invocadas por la Server Action con el client AUTENTICADO → grant a authenticated.
-- DEFINER bypassa RLS, así que cada función RE-valida tenancy (is_owner_of_consultora)
-- + draft, y valida que p_ordered_ids sea el SET EXACTO del scope (ni faltan, ni
-- sobran, ni ajenas) → INVALID_ORDER_SET, que protege contra arrays stale del client
-- tras un add/delete concurrente. Errores de dominio = tokens ASCII (raise exception
-- 'TOKEN' → SQLSTATE P0001) que la action mapea a su union.

-- =============================================================================
-- reorder_template_sections: reordena TODAS las secciones de una versión draft del
-- tenant para coincidir con p_ordered_ids (set exacto). Atómico.
-- =============================================================================
create or replace function public.reorder_template_sections(
  p_version_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consultora uuid;
  v_estado text;
  v_count int;
  v_offset constant int := 1000000;  -- > cualquier `orden` plausible del scope
begin
  -- 1. versión existe + del tenant (consultora_id NULL ⇒ sistema o no existe).
  select v.consultora_id, v.estado into v_consultora, v_estado
    from public.checklist_template_versions v
    where v.id = p_version_id;

  if v_consultora is null then
    raise exception 'VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 2. owner del tenant.
  if not public.is_owner_of_consultora(v_consultora) then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;

  -- 3. solo draft es editable.
  if v_estado <> 'draft' then
    raise exception 'VERSION_NOT_DRAFT' using errcode = 'P0001';
  end if;

  -- 4. set exacto: ni faltan, ni sobran, ni ajenas (protege contra arrays stale).
  select count(*) into v_count
    from public.template_sections s
    where s.version_id = p_version_id;

  if v_count <> coalesce(array_length(p_ordered_ids, 1), 0)
     or exists (
       select 1 from public.template_sections s
       where s.version_id = p_version_id and not (s.id = any(p_ordered_ids)))
     or exists (
       select 1 from unnest(p_ordered_ids) u(id)
       where not exists (
         select 1 from public.template_sections s
         where s.id = u.id and s.version_id = p_version_id))
  then
    raise exception 'INVALID_ORDER_SET' using errcode = 'P0001';
  end if;

  -- 5. fase 1 — bumpear fuera del rango 0..N-1 (evita colisión del índice único).
  update public.template_sections
    set orden = orden + v_offset
    where version_id = p_version_id;

  -- 6. fase 2 — asignar posiciones finales según el orden del array.
  update public.template_sections s
    set orden = ord.rn - 1
    from (select id, rn from unnest(p_ordered_ids) with ordinality as u(id, rn)) ord
    where s.id = ord.id and s.version_id = p_version_id;
end;
$$;

comment on function public.reorder_template_sections(uuid, uuid[]) is
  'T-059: reordena TODAS las secciones de una versión draft del tenant a coincidir '
  'con p_ordered_ids (set exacto). owner+draft validados. Two-phase offset (bump '
  '+1000000, luego 0..N-1) evita la colisión del índice único non-deferrable. '
  'VERSION_NOT_FOUND ⇒ NOT_FOUND; INVALID_ORDER_SET si el set no coincide.';

revoke all on function public.reorder_template_sections(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_template_sections(uuid, uuid[]) to authenticated, service_role;

-- =============================================================================
-- reorder_template_items: reordena TODOS los ítems de una sección draft del tenant
-- para coincidir con p_ordered_ids (set exacto). Atómico.
-- =============================================================================
create or replace function public.reorder_template_items(
  p_section_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consultora uuid;
  v_estado text;
  v_count int;
  v_offset constant int := 1000000;
begin
  -- 1. sección existe → resolver versión padre (consultora + estado).
  select v.consultora_id, v.estado into v_consultora, v_estado
    from public.template_sections s
    join public.checklist_template_versions v on v.id = s.version_id
    where s.id = p_section_id;

  if not found or v_consultora is null then
    raise exception 'SECTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 2. owner del tenant.
  if not public.is_owner_of_consultora(v_consultora) then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;

  -- 3. solo draft.
  if v_estado <> 'draft' then
    raise exception 'VERSION_NOT_DRAFT' using errcode = 'P0001';
  end if;

  -- 4. set exacto sobre la sección.
  select count(*) into v_count
    from public.template_items i
    where i.section_id = p_section_id;

  if v_count <> coalesce(array_length(p_ordered_ids, 1), 0)
     or exists (
       select 1 from public.template_items i
       where i.section_id = p_section_id and not (i.id = any(p_ordered_ids)))
     or exists (
       select 1 from unnest(p_ordered_ids) u(id)
       where not exists (
         select 1 from public.template_items i
         where i.id = u.id and i.section_id = p_section_id))
  then
    raise exception 'INVALID_ORDER_SET' using errcode = 'P0001';
  end if;

  -- 5. fase 1 — bumpear fuera del rango.
  update public.template_items
    set orden = orden + v_offset
    where section_id = p_section_id;

  -- 6. fase 2 — asignar finales.
  update public.template_items i
    set orden = ord.rn - 1
    from (select id, rn from unnest(p_ordered_ids) with ordinality as u(id, rn)) ord
    where i.id = ord.id and i.section_id = p_section_id;
end;
$$;

comment on function public.reorder_template_items(uuid, uuid[]) is
  'T-059: reordena TODOS los ítems de una sección draft del tenant a coincidir con '
  'p_ordered_ids (set exacto). owner+draft validados (vía la versión padre). '
  'Two-phase offset evita la colisión del índice único non-deferrable. '
  'SECTION_NOT_FOUND ⇒ NOT_FOUND; INVALID_ORDER_SET si el set no coincide.';

revoke all on function public.reorder_template_items(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_template_items(uuid, uuid[]) to authenticated, service_role;
