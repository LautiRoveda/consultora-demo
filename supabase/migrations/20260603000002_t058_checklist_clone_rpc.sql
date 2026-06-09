-- T-058 · Backend de templates de Checklists — RPCs atómicas de create/clone.
--
-- Tres funciones SECURITY DEFINER que materializan el "versionado inmutable" de
-- T-057 en transacciones atómicas (template + versión + estructura en un solo
-- commit). POR QUÉ una RPC y no copia JS multi-paso: el client no es
-- transaccional; una falla a mitad dejaría una versión draft huérfana que NO se
-- puede borrar (las versiones no tienen DELETE policy) y, como
-- uq_template_versions_one_draft garantiza ≤1 draft por template, ese draft roto
-- trancaría el slot para siempre.
--
-- Patrón = gen_acciones_calendar_for (T-057): SECURITY DEFINER + set search_path=''
-- + todo fully-qualified. DIFERENCIA: estas las invoca la Server Action con el
-- client AUTENTICADO (no service-role) → grant a authenticated. Como DEFINER
-- bypassa RLS, cada función RE-valida tenancy con los helpers T-015
-- (is_owner_of_consultora): el catálogo de templates es config del owner (como
-- EPP), enforced también a nivel DB (doble capa: la action hace requireOwner antes).
--
-- auth.uid() sigue devolviendo el usuario del JWT bajo DEFINER (el GUC
-- request.jwt.claims lo setea PostgREST por request; DEFINER cambia el rol, no el
-- claim). Los errores de dominio se emiten con tokens ASCII (raise exception
-- 'TOKEN' → SQLSTATE P0001, message='TOKEN') que la action mapea a su union.

-- =============================================================================
-- Helper interno: copia sections+items de una versión origen a una destino draft.
-- =============================================================================
-- Remap de ids set-based: como (version_id, orden) es UNIQUE, se copia `orden`
-- verbatim y se mapea sección vieja→nueva por `orden` con un join (1:1). Sin loops.
-- Reasigna consultora_id = p_consultora (tenant destino) en cada fila — la versión
-- origen puede ser de sistema (consultora_id NULL) o del propio tenant.
create or replace function public.clone_version_structure(
  p_from_version uuid,
  p_to_version uuid,
  p_consultora uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sections: copia 1:1 preservando orden (clave estable para el remap de items).
  insert into public.template_sections (version_id, consultora_id, orden, titulo, descripcion)
  select p_to_version, p_consultora, s.orden, s.titulo, s.descripcion
  from public.template_sections s
  where s.version_id = p_from_version;

  -- Items: la nueva section_id = la sección destino con el mismo orden que la
  -- sección origen del item. (version_id, orden) único ⇒ join 1:1.
  insert into public.template_items (
    section_id, version_id, consultora_id, orden, texto, response_type,
    es_critico, es_requerido, referencia_normativa, config
  )
  select ns.id, p_to_version, p_consultora, ti.orden, ti.texto, ti.response_type,
         ti.es_critico, ti.es_requerido, ti.referencia_normativa, ti.config
  from public.template_items ti
  join public.template_sections os on os.id = ti.section_id              -- sección origen (su orden)
  join public.template_sections ns on ns.version_id = p_to_version
                                  and ns.orden = os.orden                 -- sección destino por orden
  where ti.version_id = p_from_version;
end;
$$;

comment on function public.clone_version_structure(uuid, uuid, uuid) is
  'T-058: helper interno (no expuesto a authenticated). Copia sections+items de '
  'p_from_version a p_to_version reasignando consultora_id=p_consultora. Remap de '
  'section_id por (version_id, orden) único. Lo invocan las RPCs de clone dentro '
  'de su misma transacción (owner postgres ⇒ EXECUTE implícito).';

revoke all on function public.clone_version_structure(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.clone_version_structure(uuid, uuid, uuid) to service_role;

-- =============================================================================
-- create_template_with_draft: template nuevo del tenant + versión 1 draft (atómico).
-- =============================================================================
create or replace function public.create_template_with_draft(
  p_consultora_id uuid,
  p_nombre text,
  p_descripcion text,
  p_tipo_inspeccion text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tpl uuid;
  v_ver uuid;
begin
  if not public.is_owner_of_consultora(p_consultora_id) then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;

  -- Colisión de nombre activo → 23505 sobre idx_checklist_templates_consultora_nombre
  -- (la action lo mapea a DUPLICATE_NAME). p_descripcion='' (sin descripción) → NULL:
  -- los args de RPC text se tipan `string` en types.ts, así que la action manda ''
  -- en vez de null cuando no hay descripción.
  insert into public.checklist_templates (consultora_id, nombre, descripcion, tipo_inspeccion, created_by)
    values (p_consultora_id, p_nombre, nullif(p_descripcion, ''), coalesce(p_tipo_inspeccion, 'rgrl_463_09'), auth.uid())
    returning id into v_tpl;

  insert into public.checklist_template_versions (template_id, consultora_id, version_number, estado, created_by)
    values (v_tpl, p_consultora_id, 1, 'draft', auth.uid())
    returning id into v_ver;

  return jsonb_build_object('templateId', v_tpl, 'versionId', v_ver);
end;
$$;

comment on function public.create_template_with_draft(uuid, text, text, text) is
  'T-058: crea checklist_templates + checklist_template_versions(v1, draft) del '
  'tenant en una tx. owner-gated (is_owner_of_consultora). Devuelve '
  '{templateId, versionId}. Colisión de nombre ⇒ 23505 ⇒ DUPLICATE_NAME en la action.';

revoke all on function public.create_template_with_draft(uuid, text, text, text) from public, anon;
grant execute on function public.create_template_with_draft(uuid, text, text, text) to authenticated, service_role;

-- =============================================================================
-- clone_template_to_draft: clona la última versión PUBLISHED de un template del
-- tenant a una nueva versión draft (editar un template publicado). Atómico.
-- =============================================================================
create or replace function public.clone_template_to_draft(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consultora uuid;
  v_src uuid;
  v_num int;
  v_new uuid;
begin
  -- 1. Template del tenant (no archivado). consultora_id NULL ⇒ es de sistema
  --    (no editable acá → se clona con clone_system_template) o no existe.
  select t.consultora_id into v_consultora
    from public.checklist_templates t
    where t.id = p_template_id and t.archived_at is null;

  if v_consultora is null then
    raise exception 'TEMPLATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 2. owner del tenant.
  if not public.is_owner_of_consultora(v_consultora) then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;

  -- 3. última versión publicada (mayor version_number).
  select v.id into v_src
    from public.checklist_template_versions v
    where v.template_id = p_template_id and v.estado = 'published'
    order by v.version_number desc
    limit 1;

  if v_src is null then
    raise exception 'NO_PUBLISHED_VERSION' using errcode = 'P0001';
  end if;

  -- 4. número = max sobre TODAS las versiones + 1 (el índice único abarca todos los estados).
  select coalesce(max(v.version_number), 0) + 1 into v_num
    from public.checklist_template_versions v
    where v.template_id = p_template_id;

  -- 5. nueva versión draft. uq_template_versions_one_draft ⇒ ≤1 draft por template:
  --    en carrera con otro clone → 23505 (la action lo mapea a DRAFT_ALREADY_EXISTS).
  insert into public.checklist_template_versions (template_id, consultora_id, version_number, estado, created_by)
    values (p_template_id, v_consultora, v_num, 'draft', auth.uid())
    returning id into v_new;

  -- 6-7. copia estructura de la publicada a la nueva draft.
  perform public.clone_version_structure(v_src, v_new, v_consultora);

  return v_new;
end;
$$;

comment on function public.clone_template_to_draft(uuid) is
  'T-058: clona la última versión published de un template del tenant a una nueva '
  'versión draft (version_number=max+1) en una tx. owner-gated. Devuelve el id de '
  'la nueva versión. Carrera contra uq_template_versions_one_draft ⇒ 23505 ⇒ '
  'DRAFT_ALREADY_EXISTS. TEMPLATE_NOT_FOUND / NO_PUBLISHED_VERSION ⇒ NOT_FOUND.';

revoke all on function public.clone_template_to_draft(uuid) from public, anon;
grant execute on function public.clone_template_to_draft(uuid) to authenticated, service_role;

-- =============================================================================
-- clone_system_template: clona un template de SISTEMA (consultora_id NULL) a un
-- template nuevo del tenant + versión 1 draft. Atómico. Permite múltiples clones.
-- =============================================================================
create or replace function public.clone_system_template(
  p_system_template_id uuid,
  p_consultora_id uuid,
  p_nombre text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_descripcion text;
  v_tipo text;
  v_src uuid;
  v_tpl uuid;
  v_ver uuid;
begin
  -- 1. owner del tenant destino.
  if not public.is_owner_of_consultora(p_consultora_id) then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;

  -- 2. template de sistema (consultora_id NULL).
  select t.descripcion, t.tipo_inspeccion into v_descripcion, v_tipo
    from public.checklist_templates t
    where t.id = p_system_template_id and t.consultora_id is null;

  if not found then
    raise exception 'SYSTEM_TEMPLATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 3. versión publicada del template de sistema.
  select v.id into v_src
    from public.checklist_template_versions v
    where v.template_id = p_system_template_id and v.estado = 'published'
    order by v.version_number desc
    limit 1;

  if v_src is null then
    raise exception 'NO_PUBLISHED_VERSION' using errcode = 'P0001';
  end if;

  -- 4. nuevo template del tenant. Colisión de nombre → 23505 sobre
  --    idx_checklist_templates_consultora_nombre (la action lo mapea a DUPLICATE_NAME).
  insert into public.checklist_templates (consultora_id, nombre, descripcion, tipo_inspeccion, created_by)
    values (p_consultora_id, p_nombre, v_descripcion, v_tipo, auth.uid())
    returning id into v_tpl;

  -- 5. versión 1 draft.
  insert into public.checklist_template_versions (template_id, consultora_id, version_number, estado, created_by)
    values (v_tpl, p_consultora_id, 1, 'draft', auth.uid())
    returning id into v_ver;

  -- 6-7. copia estructura desde la versión de sistema.
  perform public.clone_version_structure(v_src, v_ver, p_consultora_id);

  return jsonb_build_object('templateId', v_tpl, 'versionId', v_ver);
end;
$$;

comment on function public.clone_system_template(uuid, uuid, text) is
  'T-058: clona un template de sistema (consultora_id NULL) a un template nuevo '
  'del tenant + versión 1 draft, en una tx. owner-gated. Permite múltiples clones '
  '(la action computa un nombre libre con sufijo). Devuelve {templateId, versionId}. '
  'SYSTEM_TEMPLATE_NOT_FOUND ⇒ NOT_FOUND; colisión de nombre ⇒ DUPLICATE_NAME.';

revoke all on function public.clone_system_template(uuid, uuid, text) from public, anon;
grant execute on function public.clone_system_template(uuid, uuid, text) to authenticated, service_role;
