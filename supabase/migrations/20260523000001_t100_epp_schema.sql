-- T-100 · Modulo EPP (Sprint 5) — schema base.
--
-- Tablas (7): epp_categorias, epp_items, puestos, empleados_puestos,
-- epp_entregas, epp_entrega_items, epp_planificaciones.
-- Sin server actions ni UI ni seed (vienen en T-101..T-106).
--
-- Motivacion (docs/feedback/2026-05-23-cliente-higienista-interna-construccion.md):
-- - Pilar #2 del producto (sin EPP "es Word con IA"). Bloqueante pre-launch.
-- - Cliente higienista construccion pidio explicitamente:
--   * Trazabilidad EPP por empleado (no solo por cliente).
--   * Recordatorio automatico 6 meses (Res SRT 299/11).
--   * Diferenciacion descartable (guantes, gafas) vs registrable.
--   * Arnes con numero de serie obligatorio en cada entrega.
--   * Inmutabilidad de entregas firmadas (legal).
--
-- Decisiones cerradas (post-review Lautaro):
-- 1. epp_items.es_descartable boolean: descartables NO generan planificacion
--    6m (guantes nitrilo, antiparras transparentes, barbijo N95).
-- 2. epp_items.requiere_numero_serie boolean: BEFORE INSERT trigger rechaza
--    epp_entrega_items con NULL/empty numero_serie cuando item lo requiere
--    (arnes, linea vida). Errcode 23514 (check_violation).
-- 3. epp_entrega_items.motivo_entrega enum: inicial | renovacion |
--    reposicion_rotura | reposicion_perdida | rotacion.
-- 4. epp_entrega_items.vida_util_meses_override nullable: permite extender/
--    acortar vida util default del item para esta entrega puntual.
-- 5. gen_epp_planificaciones_y_calendar_for(uuid) es FUNCION PUBLICA
--    invocable, NO trigger AFTER INSERT. Razon: epp_entrega_items se
--    insertan post-entrega y el trigger correria con 0 items. T-102 server
--    action invoca explicitamente despues de cerrar la entrega.
-- 6. Reusa calendar_events.tipo='epp_entrega' existente (T-027). NO se
--    altera el CHECK constraint. reminder_offsets_days=[14,3,0] default
--    para EPP ya definido en discovery seccion 4 (T-027:41).
-- 7. RLS: members SELECT + INSERT todo. UPDATE solo catalogo (categorias/
--    items/puestos) + empleados_puestos + planificaciones.estado.
--    epp_entregas + epp_entrega_items INMUTABLES post-INSERT (sin UPDATE
--    policy) — legal: entrega firmada = evidencia inmutable Res 299/11.
-- 8. Soft-delete via archived_at SOLO en catalogos. Entregas + items +
--    planificaciones NO se borran (legal).
-- 9. Forward-compat: empleados.puesto text legacy se mantiene.
--    empleados_puestos M:N es enrichment opcional para T-103+ ("que
--    empleados ocupan puesto X" + IA sugerencia EPP por puesto T-106).
-- 10. consultora_id denormalizado en epp_entrega_items + empleados_puestos
--     (RLS fast-path sin join, mismo trade-off que T-024 attachments +
--     T-027 calendar_event_reminders).
-- 11. Action de audit_log usa verbos canonicos 'created'/'updated'/
--     'deleted' (patron T-019/T-024/T-027/T-047/T-052/T-070).
--
-- RLS: helpers T-015 (is_member_of_consultora).
-- - Catalogos (categorias/items/puestos): any member SELECT/INSERT/UPDATE.
-- - empleados_puestos: any member SELECT/INSERT/UPDATE/DELETE (asignaciones
--   se ajustan; no son historico legal).
-- - epp_entregas + epp_entrega_items: any member SELECT/INSERT, NO UPDATE
--   ni DELETE policy (inmutables post-firma).
-- - epp_planificaciones: any member SELECT/INSERT/UPDATE (estado puede
--   pasar a 'cumplida' cuando se firma nueva entrega, o 'cancelada' por
--   baja del empleado / cambio de puesto).
--
-- =============================================================================
-- A. ENUMS (2)
-- =============================================================================

create type public.motivo_entrega_epp as enum (
  'inicial',
  'renovacion',
  'reposicion_rotura',
  'reposicion_perdida',
  'rotacion'
);

comment on type public.motivo_entrega_epp is
  'T-100: motivo de entrega EPP individual. inicial=primera entrega al empleado, '
  'renovacion=vencimiento vida util, reposicion_rotura=danio prematuro, '
  'reposicion_perdida=extravio, rotacion=cambio de puesto o tarea.';

create type public.estado_planificacion_epp as enum (
  'activa',
  'cumplida',
  'cancelada'
);

comment on type public.estado_planificacion_epp is
  'T-100: estado de la planificacion EPP. activa=pendiente de reentrega, '
  'cumplida=ya se hizo nueva entrega que reemplaza esta planificacion, '
  'cancelada=baja del empleado / cambio de puesto / EPP retirado del padron.';

-- =============================================================================
-- B. TABLAS (7, orden FK)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B.1 epp_categorias (catalogo)
-- -----------------------------------------------------------------------------

create table public.epp_categorias (
  id             uuid primary key default gen_random_uuid(),
  consultora_id  uuid not null references public.consultoras(id) on delete cascade,
  nombre         text not null check (length(trim(nombre)) between 2 and 80),
  descripcion    text check (descripcion is null or length(descripcion) <= 500),
  archived_at    timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.epp_categorias is
  'T-100: categorias de EPP por consultora (proteccion cabeza, manos, pies, '
  'ocular, caida altura, respiratoria, ropa). Catalogo seedeado en T-101 al '
  'primer acceso /epp/catalogo. Soft-delete via archived_at.';

create unique index idx_epp_categorias_consultora_nombre
  on public.epp_categorias(consultora_id, nombre)
  where archived_at is null;

create index idx_epp_categorias_consultora
  on public.epp_categorias(consultora_id)
  where archived_at is null;

-- -----------------------------------------------------------------------------
-- B.2 epp_items (catalogo, FK -> epp_categorias RESTRICT)
-- -----------------------------------------------------------------------------

create table public.epp_items (
  id                       uuid primary key default gen_random_uuid(),
  consultora_id            uuid not null references public.consultoras(id) on delete cascade,
  categoria_id             uuid not null references public.epp_categorias(id) on delete restrict,
  nombre                   text not null check (length(trim(nombre)) between 2 and 120),
  marca_default            text check (marca_default is null or length(trim(marca_default)) between 1 and 80),
  modelo_default           text check (modelo_default is null or length(trim(modelo_default)) between 1 and 80),
  vida_util_meses          int not null default 6 check (vida_util_meses between 1 and 60),
  es_descartable           boolean not null default false,
  requiere_numero_serie    boolean not null default false,
  normativa                text check (normativa is null or length(normativa) <= 200),
  notas                    text check (notas is null or length(notas) <= 2000),
  archived_at              timestamptz,
  created_by               uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.epp_items is
  'T-100: items EPP del catalogo. vida_util_meses default 6 (Res SRT 299/11). '
  'es_descartable=true: NO genera planificacion (guantes nitrilo, antiparras '
  'transparentes, barbijo N95). requiere_numero_serie=true: trigger BEFORE '
  'INSERT en epp_entrega_items rechaza entregas sin numero_serie (arnes, '
  'linea vida retractil).';

comment on column public.epp_items.vida_util_meses is
  'T-100: meses de vida util default del item. Override puntual via '
  'epp_entrega_items.vida_util_meses_override (ej: arnes intensivo 6m vs '
  'liviano 12m, decidido en cada entrega).';

create index idx_epp_items_consultora_cat
  on public.epp_items(consultora_id, categoria_id)
  where archived_at is null;

create index idx_epp_items_consultora
  on public.epp_items(consultora_id)
  where archived_at is null;

-- -----------------------------------------------------------------------------
-- B.3 puestos (catalogo)
-- -----------------------------------------------------------------------------

create table public.puestos (
  id                  uuid primary key default gen_random_uuid(),
  consultora_id       uuid not null references public.consultoras(id) on delete cascade,
  nombre              text not null check (length(trim(nombre)) between 2 and 80),
  descripcion         text check (descripcion is null or length(descripcion) <= 500),
  riesgos_asociados   text[] check (riesgos_asociados is null or array_length(riesgos_asociados, 1) <= 50),
  archived_at         timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.puestos is
  'T-100: catalogo de puestos por consultora (soldador, gruista, electricista, '
  'operario, etc). riesgos_asociados[] alimenta T-106 IA sugerencia EPP por '
  'puesto. Soft-delete via archived_at.';

comment on column public.puestos.riesgos_asociados is
  'T-100: array de tags de riesgo libre ("electrico", "caida altura", "ruido", '
  '"quimico", "biologico"). T-106 los usa como input para IA sugerencia.';

create unique index idx_puestos_consultora_nombre
  on public.puestos(consultora_id, nombre)
  where archived_at is null;

create index idx_puestos_consultora
  on public.puestos(consultora_id)
  where archived_at is null;

-- -----------------------------------------------------------------------------
-- B.4 empleados_puestos (junction M:N)
-- -----------------------------------------------------------------------------

-- consultora_id denormalizado para RLS fast-path sin join al parent empleados
-- (mismo trade-off que T-027 calendar_event_reminders L96-97).
create table public.empleados_puestos (
  empleado_id     uuid not null references public.empleados(id) on delete cascade,
  puesto_id       uuid not null references public.puestos(id) on delete cascade,
  consultora_id   uuid not null references public.consultoras(id) on delete cascade,
  asignado_at     timestamptz not null default now(),
  asignado_por    uuid references auth.users(id) on delete set null,
  primary key (empleado_id, puesto_id)
);

comment on table public.empleados_puestos is
  'T-100: junction M:N empleado <-> puesto. Enrichment opcional sobre '
  'empleados.puesto (text legacy se mantiene). UI T-103 decide UX. '
  'Alimenta T-106 IA sugerencia EPP por puesto. consultora_id denormalizado '
  'para RLS fast-path.';

create index idx_empleados_puestos_puesto
  on public.empleados_puestos(puesto_id);

create index idx_empleados_puestos_consultora
  on public.empleados_puestos(consultora_id);

-- -----------------------------------------------------------------------------
-- B.5 epp_entregas (header de entrega)
-- -----------------------------------------------------------------------------

create table public.epp_entregas (
  id                   uuid primary key default gen_random_uuid(),
  consultora_id        uuid not null references public.consultoras(id) on delete cascade,
  empleado_id          uuid not null references public.empleados(id) on delete restrict,
  cliente_id           uuid not null references public.clientes(id) on delete restrict,
  fecha_entrega        timestamptz not null default now(),
  observaciones        text check (observaciones is null or length(observaciones) <= 2000),
  firma_storage_path   text check (firma_storage_path is null or length(firma_storage_path) <= 500),
  firmado_at           timestamptz,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now()
);

comment on table public.epp_entregas is
  'T-100: header de entrega EPP firmada por empleado (Res SRT 299/11). '
  'INMUTABLE post-INSERT (sin UPDATE policy ni DELETE policy) — legal: '
  'entrega firmada = evidencia inmutable. Correcciones se hacen via nueva '
  'entrega con motivo=reposicion_rotura/perdida. FK empleado_id + cliente_id '
  'ON DELETE RESTRICT preserva referential integrity historica.';

comment on column public.epp_entregas.firma_storage_path is
  'T-100: path en Supabase Storage bucket "epp-firmas" del PNG/SVG de la '
  'firma digital capturada en canvas (T-104). NULL hasta cierre de la '
  'entrega. Una vez seteado, no se modifica.';

comment on column public.epp_entregas.firmado_at is
  'T-100: timestamp del cierre de la entrega (cuando T-102 invoca cierre + '
  'firma). NULL = entrega abierta (drafts permitidos en UI antes de cerrar). '
  'Set una vez, no se modifica.';

create index idx_epp_entregas_empleado_fecha
  on public.epp_entregas(empleado_id, fecha_entrega desc);

create index idx_epp_entregas_cliente_fecha
  on public.epp_entregas(cliente_id, fecha_entrega desc);

create index idx_epp_entregas_consultora_fecha
  on public.epp_entregas(consultora_id, fecha_entrega desc);

-- -----------------------------------------------------------------------------
-- B.6 epp_entrega_items (detalle de entrega)
-- -----------------------------------------------------------------------------

-- consultora_id denormalizado para RLS fast-path sin join al parent epp_entregas
-- (mismo trade-off que T-024 informe_attachments + T-027 calendar_event_reminders).
create table public.epp_entrega_items (
  id                          uuid primary key default gen_random_uuid(),
  entrega_id                  uuid not null references public.epp_entregas(id) on delete cascade,
  item_id                     uuid not null references public.epp_items(id) on delete restrict,
  consultora_id               uuid not null references public.consultoras(id) on delete cascade,
  cantidad                    int not null default 1 check (cantidad between 1 and 100),
  numero_serie                text check (numero_serie is null or length(trim(numero_serie)) between 1 and 80),
  motivo_entrega              public.motivo_entrega_epp not null default 'inicial',
  vida_util_meses_override    int check (vida_util_meses_override is null or vida_util_meses_override between 1 and 60),
  marca_entregada             text check (marca_entregada is null or length(trim(marca_entregada)) between 1 and 80),
  modelo_entregado            text check (modelo_entregado is null or length(trim(modelo_entregado)) between 1 and 80),
  created_at                  timestamptz not null default now()
);

comment on table public.epp_entrega_items is
  'T-100: detalle linea por linea de una entrega EPP. INMUTABLE post-INSERT. '
  'numero_serie obligatorio si epp_items.requiere_numero_serie=true (validado '
  'por trigger BEFORE INSERT). vida_util_meses_override sobrescribe el default '
  'del item para esta entrega puntual. consultora_id denormalizado para RLS '
  'fast-path.';

create index idx_epp_entrega_items_entrega
  on public.epp_entrega_items(entrega_id);

create index idx_epp_entrega_items_item
  on public.epp_entrega_items(item_id);

-- -----------------------------------------------------------------------------
-- B.7 epp_planificaciones (proxima reentrega calculada)
-- -----------------------------------------------------------------------------

create table public.epp_planificaciones (
  id                        uuid primary key default gen_random_uuid(),
  consultora_id             uuid not null references public.consultoras(id) on delete cascade,
  empleado_id               uuid not null references public.empleados(id) on delete restrict,
  item_id                   uuid not null references public.epp_items(id) on delete restrict,
  fecha_proxima_entrega     timestamptz not null,
  frecuencia_meses          int not null check (frecuencia_meses between 1 and 60),
  generado_de_entrega_id    uuid not null references public.epp_entregas(id) on delete restrict,
  calendar_event_id         uuid references public.calendar_events(id) on delete set null,
  estado                    public.estado_planificacion_epp not null default 'activa',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.epp_planificaciones is
  'T-100: planificacion de proxima reentrega EPP. Generada automaticamente '
  'por gen_epp_planificaciones_y_calendar_for(entrega_id) tras cierre de '
  'entrega, para cada item NO descartable. estado=cumplida cuando se firma '
  'nueva entrega (T-102 marca via server action). estado=cancelada si baja '
  'del empleado / cambio puesto / EPP retirado del padron. calendar_event_id '
  'apunta al evento de calendario auto-creado (tipo=epp_entrega).';

create index idx_epp_planificaciones_proxima_activa
  on public.epp_planificaciones(consultora_id, fecha_proxima_entrega)
  where estado = 'activa';

create index idx_epp_planificaciones_empleado
  on public.epp_planificaciones(empleado_id, estado);

create index idx_epp_planificaciones_calendar_event
  on public.epp_planificaciones(calendar_event_id)
  where calendar_event_id is not null;

-- =============================================================================
-- C. TRIGGERS set_updated_at (5: solo tablas con updated_at)
-- =============================================================================

create trigger set_updated_at_epp_categorias
  before update on public.epp_categorias
  for each row execute function public.set_updated_at();

create trigger set_updated_at_epp_items
  before update on public.epp_items
  for each row execute function public.set_updated_at();

create trigger set_updated_at_puestos
  before update on public.puestos
  for each row execute function public.set_updated_at();

create trigger set_updated_at_epp_planificaciones
  before update on public.epp_planificaciones
  for each row execute function public.set_updated_at();

-- epp_entregas, epp_entrega_items, empleados_puestos: NO tienen updated_at
-- (inmutables / junction sin trigger).

-- =============================================================================
-- D. TRIGGER BEFORE INSERT validacion numero_serie
-- =============================================================================

-- Patron: BEFORE INSERT trigger normal (no constraint trigger). El repo no
-- tiene precedente de constraint triggers — un BEFORE INSERT lleva al mismo
-- resultado sin complejidad adicional. errcode 23514 (check_violation)
-- para que el cliente JS pueda diferenciar de otros errores.
create or replace function public.epp_validate_numero_serie()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requiere boolean;
  v_item_nombre text;
begin
  select i.requiere_numero_serie, i.nombre
    into v_requiere, v_item_nombre
    from public.epp_items i
    where i.id = new.item_id;

  if v_requiere and (new.numero_serie is null or length(trim(new.numero_serie)) = 0) then
    raise exception 'EPP item % (%) requiere numero_serie en cada entrega', v_item_nombre, new.item_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.epp_validate_numero_serie() is
  'T-100: BEFORE INSERT trigger en epp_entrega_items. Rechaza inserts cuando '
  'epp_items.requiere_numero_serie=true y numero_serie es NULL o vacio. '
  'Errcode 23514 (check_violation) para discriminar en client error handling.';

create trigger epp_entrega_items_validate_serie
  before insert on public.epp_entrega_items
  for each row execute function public.epp_validate_numero_serie();

-- =============================================================================
-- E. FUNCION publica gen_epp_planificaciones_y_calendar_for
-- =============================================================================

-- NO es trigger AFTER INSERT en epp_entregas: epp_entrega_items se insertan
-- DESPUES del header, asi que un trigger correria con 0 items y no generaria
-- nada. T-102 invoca esta funcion explicitamente desde server action despues
-- de poblar todos los items (en el mismo transaction o al cerrar entrega).
--
-- SEGURIDAD CRITICA: security definer bypassa RLS. NO se otorga a authenticated
-- (cross-tenant abuse: un user podria invocar con entrega_id de otra consultora
-- y generar planificaciones falsas). Solo service_role -> T-102 instancia
-- createServiceRoleClient() y llama rpc('gen_epp_planificaciones_y_calendar_for').
-- Patron consistente con webhook MP / cron handlers (T-031/T-074).
create or replace function public.gen_epp_planificaciones_y_calendar_for(p_entrega_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entrega       record;
  v_empleado      record;
  v_item          record;
  v_vida_util     int;
  v_fecha_proxima timestamptz;
  v_calendar_id   uuid;
begin
  select id, consultora_id, empleado_id, fecha_entrega, created_by
    into v_entrega
    from public.epp_entregas
    where id = p_entrega_id;

  if v_entrega.id is null then
    raise exception 'epp_entregas % no encontrada', p_entrega_id using errcode = '02000';
  end if;

  select e.nombre, e.apellido
    into v_empleado
    from public.empleados e
    where e.id = v_entrega.empleado_id;

  for v_item in
    select ei.id           as entrega_item_id,
           ei.item_id,
           ei.vida_util_meses_override,
           i.nombre        as item_nombre,
           i.vida_util_meses,
           i.es_descartable
      from public.epp_entrega_items ei
      join public.epp_items i on i.id = ei.item_id
      where ei.entrega_id = p_entrega_id
        and i.es_descartable = false
  loop
    v_vida_util := coalesce(v_item.vida_util_meses_override, v_item.vida_util_meses);
    v_fecha_proxima := v_entrega.fecha_entrega + (v_vida_util || ' months')::interval;

    -- 1. Crear calendar_event (tipo='epp_entrega' reusa T-027, reminder
    --    offsets [14,3,0] estandar EPP definido en discovery seccion 4).
    insert into public.calendar_events (
      consultora_id, tipo, titulo, fecha_vencimiento,
      reminder_offsets_days, status, created_by, metadata
    ) values (
      v_entrega.consultora_id,
      'epp_entrega',
      'Vencimiento EPP: ' || v_item.item_nombre || ' — ' || v_empleado.nombre || ' ' || v_empleado.apellido,
      v_fecha_proxima::date,
      array[14, 3, 0],
      'pending',
      v_entrega.created_by,
      jsonb_build_object(
        'empleado_id', v_entrega.empleado_id,
        'epp_item_id', v_item.item_id,
        'epp_entrega_id', v_entrega.id,
        'vida_util_meses', v_vida_util
      )
    )
    returning id into v_calendar_id;

    -- 2. Crear epp_planificaciones linkeada al calendar_event.
    insert into public.epp_planificaciones (
      consultora_id, empleado_id, item_id, fecha_proxima_entrega, frecuencia_meses,
      generado_de_entrega_id, calendar_event_id, estado
    ) values (
      v_entrega.consultora_id,
      v_entrega.empleado_id,
      v_item.item_id,
      v_fecha_proxima,
      v_vida_util,
      v_entrega.id,
      v_calendar_id,
      'activa'
    );
  end loop;
end;
$$;

-- SEGURIDAD: revoke from public/anon/authenticated, grant solo service_role.
revoke execute on function public.gen_epp_planificaciones_y_calendar_for(uuid)
  from public, anon, authenticated;
grant execute on function public.gen_epp_planificaciones_y_calendar_for(uuid) to service_role;

comment on function public.gen_epp_planificaciones_y_calendar_for(uuid) is
  'T-100: post-entrega EPP. Genera epp_planificaciones + calendar_events '
  '(tipo=epp_entrega, reminder_offsets [14,3,0]) para cada epp_entrega_items '
  'cuyo item.es_descartable=false. SOLO invocable desde server actions con '
  'admin client (service_role) — NO authenticated, porque security definer '
  'bypassa RLS y podria crear planificaciones cross-tenant. Patron '
  'consistente con createServiceRoleClient en webhook MP / cron handlers.';

-- =============================================================================
-- F. AUDIT TRIGGERS (7 funciones + 21 triggers)
-- =============================================================================

-- Patron copy de T-047 clientes / T-052 empleados / T-070 pagos:
-- - 1 funcion audit_<tabla>() por tabla.
-- - 3 triggers (after_insert / after_update / after_delete) por tabla.
-- - Guard `is distinct from` sobre tupla de campos mutables en UPDATE.
-- - Payload jsonb_build_object con snapshot de campos selectos (no todos).

-- -----------------------------------------------------------------------------
-- F.1 audit_epp_categorias
-- -----------------------------------------------------------------------------

create or replace function public.audit_epp_categorias()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_payload jsonb;
  v_after_payload jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (new.consultora_id, auth.uid(), 'created', 'epp_categorias', new.id,
       null,
       jsonb_build_object('nombre', new.nombre));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.nombre, new.descripcion, new.archived_at)
       is distinct from
       (old.nombre, old.descripcion, old.archived_at) then
      v_before_payload := jsonb_build_object(
        'nombre', old.nombre, 'descripcion', old.descripcion,
        'archived_at', old.archived_at);
      v_after_payload := jsonb_build_object(
        'nombre', new.nombre, 'descripcion', new.descripcion,
        'archived_at', new.archived_at);
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'epp_categorias', new.id,
         v_before_payload, v_after_payload);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'epp_categorias', old.id,
       jsonb_build_object('nombre', old.nombre, 'archived_at', old.archived_at),
       null);
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_epp_categorias_after_insert
  after insert on public.epp_categorias
  for each row execute function public.audit_epp_categorias();
create trigger audit_epp_categorias_after_update
  after update on public.epp_categorias
  for each row execute function public.audit_epp_categorias();
create trigger audit_epp_categorias_after_delete
  after delete on public.epp_categorias
  for each row execute function public.audit_epp_categorias();

-- -----------------------------------------------------------------------------
-- F.2 audit_epp_items
-- -----------------------------------------------------------------------------

create or replace function public.audit_epp_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_payload jsonb;
  v_after_payload jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (new.consultora_id, auth.uid(), 'created', 'epp_items', new.id,
       null,
       jsonb_build_object(
         'nombre', new.nombre, 'categoria_id', new.categoria_id,
         'vida_util_meses', new.vida_util_meses,
         'es_descartable', new.es_descartable,
         'requiere_numero_serie', new.requiere_numero_serie));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.nombre, new.categoria_id, new.marca_default, new.modelo_default,
        new.vida_util_meses, new.es_descartable, new.requiere_numero_serie,
        new.normativa, new.archived_at)
       is distinct from
       (old.nombre, old.categoria_id, old.marca_default, old.modelo_default,
        old.vida_util_meses, old.es_descartable, old.requiere_numero_serie,
        old.normativa, old.archived_at) then
      v_before_payload := jsonb_build_object(
        'nombre', old.nombre, 'categoria_id', old.categoria_id,
        'marca_default', old.marca_default, 'modelo_default', old.modelo_default,
        'vida_util_meses', old.vida_util_meses,
        'es_descartable', old.es_descartable,
        'requiere_numero_serie', old.requiere_numero_serie,
        'normativa', old.normativa, 'archived_at', old.archived_at);
      v_after_payload := jsonb_build_object(
        'nombre', new.nombre, 'categoria_id', new.categoria_id,
        'marca_default', new.marca_default, 'modelo_default', new.modelo_default,
        'vida_util_meses', new.vida_util_meses,
        'es_descartable', new.es_descartable,
        'requiere_numero_serie', new.requiere_numero_serie,
        'normativa', new.normativa, 'archived_at', new.archived_at);
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'epp_items', new.id,
         v_before_payload, v_after_payload);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'epp_items', old.id,
       jsonb_build_object('nombre', old.nombre, 'archived_at', old.archived_at),
       null);
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_epp_items_after_insert
  after insert on public.epp_items
  for each row execute function public.audit_epp_items();
create trigger audit_epp_items_after_update
  after update on public.epp_items
  for each row execute function public.audit_epp_items();
create trigger audit_epp_items_after_delete
  after delete on public.epp_items
  for each row execute function public.audit_epp_items();

-- -----------------------------------------------------------------------------
-- F.3 audit_puestos
-- -----------------------------------------------------------------------------

create or replace function public.audit_puestos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_payload jsonb;
  v_after_payload jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (new.consultora_id, auth.uid(), 'created', 'puestos', new.id,
       null,
       jsonb_build_object('nombre', new.nombre,
                          'riesgos_asociados', new.riesgos_asociados));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.nombre, new.descripcion, new.riesgos_asociados, new.archived_at)
       is distinct from
       (old.nombre, old.descripcion, old.riesgos_asociados, old.archived_at) then
      v_before_payload := jsonb_build_object(
        'nombre', old.nombre, 'descripcion', old.descripcion,
        'riesgos_asociados', old.riesgos_asociados,
        'archived_at', old.archived_at);
      v_after_payload := jsonb_build_object(
        'nombre', new.nombre, 'descripcion', new.descripcion,
        'riesgos_asociados', new.riesgos_asociados,
        'archived_at', new.archived_at);
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'puestos', new.id,
         v_before_payload, v_after_payload);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'puestos', old.id,
       jsonb_build_object('nombre', old.nombre, 'archived_at', old.archived_at),
       null);
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_puestos_after_insert
  after insert on public.puestos
  for each row execute function public.audit_puestos();
create trigger audit_puestos_after_update
  after update on public.puestos
  for each row execute function public.audit_puestos();
create trigger audit_puestos_after_delete
  after delete on public.puestos
  for each row execute function public.audit_puestos();

-- -----------------------------------------------------------------------------
-- F.4 audit_empleados_puestos
-- -----------------------------------------------------------------------------

create or replace function public.audit_empleados_puestos()
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
      (new.consultora_id, auth.uid(), 'created', 'empleados_puestos', new.empleado_id,
       null,
       jsonb_build_object(
         'empleado_id', new.empleado_id,
         'puesto_id', new.puesto_id));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'empleados_puestos', old.empleado_id,
       jsonb_build_object(
         'empleado_id', old.empleado_id,
         'puesto_id', old.puesto_id),
       null);
    return old;
  end if;
  -- UPDATE deliberadamente no auditado (es junction PK, no se updatea — se
  -- borra y reinserta).
  return null;
end;
$$;

create trigger audit_empleados_puestos_after_insert
  after insert on public.empleados_puestos
  for each row execute function public.audit_empleados_puestos();
create trigger audit_empleados_puestos_after_delete
  after delete on public.empleados_puestos
  for each row execute function public.audit_empleados_puestos();

-- -----------------------------------------------------------------------------
-- F.5 audit_epp_entregas (INMUTABLE: solo INSERT / DELETE service-role audit)
-- -----------------------------------------------------------------------------

-- epp_entregas no tiene UPDATE policy -> trigger UPDATE no se dispara desde
-- authenticated. Lo dejamos por completitud (service-role admin edge case).
create or replace function public.audit_epp_entregas()
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
      (new.consultora_id, auth.uid(), 'created', 'epp_entregas', new.id,
       null,
       jsonb_build_object(
         'empleado_id', new.empleado_id,
         'cliente_id', new.cliente_id,
         'fecha_entrega', new.fecha_entrega,
         'firmado_at', new.firmado_at));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.firmado_at, new.firma_storage_path, new.observaciones)
       is distinct from
       (old.firmado_at, old.firma_storage_path, old.observaciones) then
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'epp_entregas', new.id,
         jsonb_build_object(
           'firmado_at', old.firmado_at,
           'firma_storage_path', old.firma_storage_path,
           'observaciones', old.observaciones),
         jsonb_build_object(
           'firmado_at', new.firmado_at,
           'firma_storage_path', new.firma_storage_path,
           'observaciones', new.observaciones));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'epp_entregas', old.id,
       jsonb_build_object(
         'empleado_id', old.empleado_id,
         'cliente_id', old.cliente_id,
         'fecha_entrega', old.fecha_entrega),
       null);
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_epp_entregas_after_insert
  after insert on public.epp_entregas
  for each row execute function public.audit_epp_entregas();
create trigger audit_epp_entregas_after_update
  after update on public.epp_entregas
  for each row execute function public.audit_epp_entregas();
create trigger audit_epp_entregas_after_delete
  after delete on public.epp_entregas
  for each row execute function public.audit_epp_entregas();

-- -----------------------------------------------------------------------------
-- F.6 audit_epp_entrega_items (INMUTABLE)
-- -----------------------------------------------------------------------------

create or replace function public.audit_epp_entrega_items()
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
      (new.consultora_id, auth.uid(), 'created', 'epp_entrega_items', new.id,
       null,
       jsonb_build_object(
         'entrega_id', new.entrega_id,
         'item_id', new.item_id,
         'cantidad', new.cantidad,
         'motivo_entrega', new.motivo_entrega,
         'numero_serie', new.numero_serie));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'epp_entrega_items', old.id,
       jsonb_build_object(
         'entrega_id', old.entrega_id,
         'item_id', old.item_id,
         'cantidad', old.cantidad,
         'numero_serie', old.numero_serie),
       null);
    return old;
  end if;
  -- UPDATE no auditado: items inmutables post-INSERT (sin UPDATE policy).
  return null;
end;
$$;

create trigger audit_epp_entrega_items_after_insert
  after insert on public.epp_entrega_items
  for each row execute function public.audit_epp_entrega_items();
create trigger audit_epp_entrega_items_after_delete
  after delete on public.epp_entrega_items
  for each row execute function public.audit_epp_entrega_items();

-- -----------------------------------------------------------------------------
-- F.7 audit_epp_planificaciones
-- -----------------------------------------------------------------------------

create or replace function public.audit_epp_planificaciones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_payload jsonb;
  v_after_payload jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (new.consultora_id, auth.uid(), 'created', 'epp_planificaciones', new.id,
       null,
       jsonb_build_object(
         'empleado_id', new.empleado_id,
         'item_id', new.item_id,
         'fecha_proxima_entrega', new.fecha_proxima_entrega,
         'frecuencia_meses', new.frecuencia_meses,
         'generado_de_entrega_id', new.generado_de_entrega_id,
         'estado', new.estado));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.fecha_proxima_entrega, new.frecuencia_meses, new.estado, new.calendar_event_id)
       is distinct from
       (old.fecha_proxima_entrega, old.frecuencia_meses, old.estado, old.calendar_event_id) then
      v_before_payload := jsonb_build_object(
        'fecha_proxima_entrega', old.fecha_proxima_entrega,
        'frecuencia_meses', old.frecuencia_meses,
        'estado', old.estado,
        'calendar_event_id', old.calendar_event_id);
      v_after_payload := jsonb_build_object(
        'fecha_proxima_entrega', new.fecha_proxima_entrega,
        'frecuencia_meses', new.frecuencia_meses,
        'estado', new.estado,
        'calendar_event_id', new.calendar_event_id);
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'epp_planificaciones', new.id,
         v_before_payload, v_after_payload);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'epp_planificaciones', old.id,
       jsonb_build_object(
         'empleado_id', old.empleado_id,
         'item_id', old.item_id,
         'fecha_proxima_entrega', old.fecha_proxima_entrega,
         'estado', old.estado),
       null);
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_epp_planificaciones_after_insert
  after insert on public.epp_planificaciones
  for each row execute function public.audit_epp_planificaciones();
create trigger audit_epp_planificaciones_after_update
  after update on public.epp_planificaciones
  for each row execute function public.audit_epp_planificaciones();
create trigger audit_epp_planificaciones_after_delete
  after delete on public.epp_planificaciones
  for each row execute function public.audit_epp_planificaciones();

-- =============================================================================
-- G. RLS (helpers T-015: is_member_of_consultora)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- G.1 epp_categorias (catalogo: any member SELECT/INSERT/UPDATE)
-- -----------------------------------------------------------------------------

alter table public.epp_categorias enable row level security;

create policy epp_categorias_select_own on public.epp_categorias
  for select using (public.is_member_of_consultora(consultora_id));

create policy epp_categorias_insert_own on public.epp_categorias
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );

create policy epp_categorias_update_own on public.epp_categorias
  for update
  using (public.is_member_of_consultora(consultora_id))
  with check (public.is_member_of_consultora(consultora_id));

-- DELETE: SIN policy. Soft-delete via archived_at.

-- -----------------------------------------------------------------------------
-- G.2 epp_items (catalogo: any member SELECT/INSERT/UPDATE)
-- -----------------------------------------------------------------------------

alter table public.epp_items enable row level security;

create policy epp_items_select_own on public.epp_items
  for select using (public.is_member_of_consultora(consultora_id));

create policy epp_items_insert_own on public.epp_items
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );

create policy epp_items_update_own on public.epp_items
  for update
  using (public.is_member_of_consultora(consultora_id))
  with check (public.is_member_of_consultora(consultora_id));

-- DELETE: SIN policy. Soft-delete via archived_at.

-- -----------------------------------------------------------------------------
-- G.3 puestos (catalogo: any member SELECT/INSERT/UPDATE)
-- -----------------------------------------------------------------------------

alter table public.puestos enable row level security;

create policy puestos_select_own on public.puestos
  for select using (public.is_member_of_consultora(consultora_id));

create policy puestos_insert_own on public.puestos
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );

create policy puestos_update_own on public.puestos
  for update
  using (public.is_member_of_consultora(consultora_id))
  with check (public.is_member_of_consultora(consultora_id));

-- DELETE: SIN policy. Soft-delete via archived_at.

-- -----------------------------------------------------------------------------
-- G.4 empleados_puestos (M:N: any member SELECT/INSERT/DELETE — sin UPDATE,
-- las asignaciones se borran/reinsertan; sin soft-delete porque es junction)
-- -----------------------------------------------------------------------------

alter table public.empleados_puestos enable row level security;

create policy empleados_puestos_select_own on public.empleados_puestos
  for select using (public.is_member_of_consultora(consultora_id));

create policy empleados_puestos_insert_own on public.empleados_puestos
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and (asignado_por is null or asignado_por = auth.uid())
  );

create policy empleados_puestos_delete_own on public.empleados_puestos
  for delete using (public.is_member_of_consultora(consultora_id));

-- -----------------------------------------------------------------------------
-- G.5 epp_entregas (INMUTABLE: SELECT + INSERT, NO UPDATE/DELETE)
-- -----------------------------------------------------------------------------

alter table public.epp_entregas enable row level security;

create policy epp_entregas_select_own on public.epp_entregas
  for select using (public.is_member_of_consultora(consultora_id));

create policy epp_entregas_insert_own on public.epp_entregas
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );

comment on policy epp_entregas_select_own on public.epp_entregas is
  'T-100: any member del tenant ve las entregas EPP (data compartida — '
  'cualquier tecnico debe ver historico).';

comment on policy epp_entregas_insert_own on public.epp_entregas is
  'T-100: any member crea entregas, auto-atribuido via created_by=auth.uid(). '
  'Despues del INSERT, T-102 server action invoca rpc('
  'gen_epp_planificaciones_y_calendar_for) con service-role para generar '
  'planificaciones + calendar events.';

-- UPDATE: SIN policy. Inmutabilidad legal Res 299/11. Correcciones via nueva
-- entrega con motivo=reposicion_*. firma + firmado_at se setea EN el INSERT
-- (no es flujo update-after-create) o via service-role admin.
-- DELETE: SIN policy. Sin soft-delete (legal: evidencia inmutable).

-- -----------------------------------------------------------------------------
-- G.6 epp_entrega_items (INMUTABLE: SELECT + INSERT, NO UPDATE/DELETE)
-- -----------------------------------------------------------------------------

alter table public.epp_entrega_items enable row level security;

create policy epp_entrega_items_select_own on public.epp_entrega_items
  for select using (public.is_member_of_consultora(consultora_id));

-- INSERT valida que la entrega_id pertenece al tenant del user (denormalizado
-- en consultora_id, ademas join al parent para defensa adicional).
create policy epp_entrega_items_insert_own on public.epp_entrega_items
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.epp_entregas e
      where e.id = epp_entrega_items.entrega_id
        and e.consultora_id = epp_entrega_items.consultora_id
    )
  );

-- UPDATE: SIN policy. Items inmutables (cambios = nueva entrega).
-- DELETE: SIN policy.

-- -----------------------------------------------------------------------------
-- G.7 epp_planificaciones (SELECT + INSERT + UPDATE; sin DELETE)
-- -----------------------------------------------------------------------------

alter table public.epp_planificaciones enable row level security;

create policy epp_planificaciones_select_own on public.epp_planificaciones
  for select using (public.is_member_of_consultora(consultora_id));

-- INSERT solo desde service-role en la practica (lo crea
-- gen_epp_planificaciones_y_calendar_for). Igual abrimos a authenticated
-- por simetria + future-proofing (UI de planificacion manual en T-106).
create policy epp_planificaciones_insert_own on public.epp_planificaciones
  for insert with check (
    public.is_member_of_consultora(consultora_id)
  );

-- UPDATE permite cambiar estado (activa -> cumplida / cancelada) y
-- fecha_proxima_entrega (postergaciones manuales del consultor).
create policy epp_planificaciones_update_own on public.epp_planificaciones
  for update
  using (public.is_member_of_consultora(consultora_id))
  with check (public.is_member_of_consultora(consultora_id));

-- DELETE: SIN policy.
