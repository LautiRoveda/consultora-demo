-- T-075 · Link incidente <-> informe IA de investigacion (UPDATE acotado).
--
-- Problema: `incidentes` es append-only por RLS (SELECT + INSERT, sin UPDATE).
-- Setear `informe_id` en un registro existente requeriria una policy UPDATE, que
-- abriria la puerta a mutar CUALQUIER columna (RLS opera por fila, no por columna).
--
-- Solucion: una funcion `security definer` que es la UNICA via de mutacion y SOLO
-- setea `informe_id`. NO se agrega policy UPDATE general -> el append-only del resto
-- queda intacto (authenticated sigue con 0 filas en UPDATE/DELETE directo). Mismo
-- patron de escritura privilegiada controlada que create_consultora_and_owner (T-012).
--
-- security definer BYPASSA la RLS -> los checks de tenancy dentro de la funcion son
-- OBLIGATORIOS (sin ellos, cross-tenant). FOR UPDATE serializa el doble-click.
--
-- Audit: el trigger AFTER UPDATE (audit_incidentes) ya audita cambios de informe_id;
-- aca lo afinamos para distinguir el link iniciado por el usuario (action='linked')
-- del set-null de sistema por FK on-delete (action='updated'). audit_log.action es
-- text sin CHECK (lista abierta) -> agregar 'linked' no requiere alterar constraints.

-- =============================================================================
-- A. RPC link_informe_to_incidente (UPDATE acotado a informe_id)
-- =============================================================================

create or replace function public.link_informe_to_incidente(
  p_incidente_id uuid,
  p_informe_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consultora_id     uuid;
  v_tipo              public.tipo_incidente;
  v_anulacion         boolean;
  v_informe_id_actual uuid;
  v_superseded        boolean;
  v_inf_consultora    uuid;
  v_inf_tipo          text;
begin
  -- 1) Cargar + LOCK del incidente (serializa el doble-click: el perdedor relee
  --    informe_id ya seteado y cae en el guard de idempotencia -> 23505).
  select i.consultora_id, i.tipo, i.anulacion, i.informe_id
    into v_consultora_id, v_tipo, v_anulacion, v_informe_id_actual
    from public.incidentes i
    where i.id = p_incidente_id
    for update;
  if not found then
    raise exception 'incidente no encontrado' using errcode = 'no_data_found';
  end if;

  -- 2) Tenancy (security definer bypassa RLS -> check EXPLICITO obligatorio).
  if not public.is_member_of_consultora(v_consultora_id) then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';  -- 42501
  end if;

  -- 3) Solo sobre el registro VIGENTE (no anulado, no superseded) y accidente.
  if v_anulacion then
    raise exception 'incidente anulado' using errcode = 'check_violation';  -- 23514
  end if;
  select exists (
    select 1 from public.incidentes s where s.corrige_id = p_incidente_id
  ) into v_superseded;
  if v_superseded then
    raise exception 'incidente superseded' using errcode = 'check_violation';
  end if;
  if v_tipo <> 'accidente' then
    raise exception 'solo accidente' using errcode = 'check_violation';
  end if;

  -- 4) Idempotencia / no-overwrite: solo NULL -> not null.
  if v_informe_id_actual is not null then
    raise exception 'incidente ya vinculado' using errcode = 'unique_violation';  -- 23505
  end if;

  -- 5) Validar el informe: mismo tenant + tipo accidente.
  select inf.consultora_id, inf.tipo
    into v_inf_consultora, v_inf_tipo
    from public.informes inf
    where inf.id = p_informe_id
    for update;
  if not found then
    raise exception 'informe no encontrado' using errcode = 'no_data_found';
  end if;
  if v_inf_consultora <> v_consultora_id then
    raise exception 'informe de otro tenant' using errcode = 'insufficient_privilege';
  end if;
  if v_inf_tipo <> 'accidente' then
    raise exception 'informe no es de tipo accidente' using errcode = 'check_violation';
  end if;

  -- 6) UPDATE acotado: SOLO informe_id. El trigger AFTER UPDATE audita 'linked'.
  update public.incidentes
    set informe_id = p_informe_id
    where id = p_incidente_id;
end;
$$;

comment on function public.link_informe_to_incidente(uuid, uuid) is
  'T-075: UNICA via para setear incidentes.informe_id en un registro existente '
  '(append-only: no hay policy UPDATE). security definer + checks de tenancy + '
  'guards (vigente, accidente, informe_id null, informe mismo tenant). Solo toca '
  'informe_id. El trigger audit_incidentes registra action=linked.';

revoke all on function public.link_informe_to_incidente(uuid, uuid) from public, anon;
grant execute on function public.link_informe_to_incidente(uuid, uuid) to authenticated, service_role;

-- =============================================================================
-- B. audit_incidentes: distinguir 'linked' (user) de 'updated' (sistema)
-- =============================================================================

-- Copia VERBATIM del cuerpo de T-062, cambiando SOLO el branch UPDATE para
-- derivar action='linked' cuando old.informe_id IS NULL y new.informe_id NOT NULL
-- (el link via RPC). El set-null de sistema (FK on delete) sigue siendo 'updated'.
create or replace function public.audit_incidentes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    -- action derivada: alta vs correccion vs anulacion.
    if new.anulacion then
      v_action := 'annulled';
    elsif new.corrige_id is not null then
      v_action := 'corrected';
    else
      v_action := 'created';
    end if;
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (new.consultora_id, auth.uid(), v_action, 'incidentes', new.id,
       null,
       -- PII: solo referencia empleado_id (uuid), nunca nombre/DNI.
       jsonb_build_object(
         'tipo', new.tipo,
         'fecha', new.fecha,
         'gravedad', new.gravedad,
         'dias_perdidos', new.dias_perdidos,
         'cliente_id', new.cliente_id,
         'empleado_id', new.empleado_id,
         'informe_id', new.informe_id,
         'corrige_id', new.corrige_id,
         'anulacion', new.anulacion));
    return new;
  elsif tg_op = 'UPDATE' then
    -- UPDATE ocurre por: (a) link via RPC link_informe_to_incidente (T-075) ->
    -- old.informe_id NULL -> not null -> action='linked'; (b) set-null de sistema
    -- por FK on delete (informe_id / created_by) -> action='updated'.
    if (new.informe_id, new.created_by) is distinct from (old.informe_id, old.created_by) then
      if old.informe_id is null and new.informe_id is not null then
        v_action := 'linked';
      else
        v_action := 'updated';
      end if;
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), v_action, 'incidentes', new.id,
         jsonb_build_object('informe_id', old.informe_id, 'created_by', old.created_by),
         jsonb_build_object('informe_id', new.informe_id, 'created_by', new.created_by));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    -- Solo ocurre por cascade (purga de consultora). Edge no-prod.
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'incidentes', old.id,
       jsonb_build_object('tipo', old.tipo, 'fecha', old.fecha, 'gravedad', old.gravedad),
       null);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_incidentes() is
  'T-062 (afinada en T-075): trigger AFTER -> audit_log. INSERT -> '
  'created/corrected/annulled. UPDATE -> linked (RPC link_informe_to_incidente, '
  'informe_id NULL->not null) o updated (set-null de sistema). DELETE -> deleted '
  '(cascade). PII: solo empleado_id (uuid), nunca nombre/DNI.';
