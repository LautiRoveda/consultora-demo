-- T-057 · Modulo Checklists (RGRL-native) — schema base (DB + RLS + RPC + seed piloto).
--
-- Inspecciones RGRL digitales (Res. SRT 463/09, variante Dec. 351/79). El gancho
-- de producto: cada item "NO cumple" con su fecha de regularizacion genera una
-- ACCION CORRECTIVA de primera clase que se inyecta en el Calendario (T-027) como
-- vencimiento con alertas (reusa cron T-031 + Resend/Telegram/Push).
--
-- Supersede el schema FANTASMA de data-model.md §M8 (jsonb suelto, RLS inline a
-- `consultora_users` inexistente, sin versionado/establecimiento/CAPA). Se rehace
-- normalizado con helpers T-015 + ancla cliente_id. Doc-sync de M8 = ticket aparte.
--
-- DECISIONES (RFC T-057, owner-aprobadas):
-- - VERSIONADO INMUTABLE: la estructura (sections/items) cuelga de una
--   `checklist_template_versions`. Editar un template publicado = clonar a nueva
--   version draft. La ejecucion FK la version exacta -> editar nunca altera
--   inspecciones pasadas. Inmutabilidad de la version publicada via RLS (las
--   policies de sections/items gatean por `EXISTS(... version.estado='draft')`),
--   NO por trigger.
-- - FREEZE POR RLS (no trigger): la ejecucion es mutable mientras `borrador`
--   (auto-save), y se congela al cerrar. La UPDATE policy usa
--   `USING (estado='borrador')` -> un UPDATE sobre una fila cerrada matchea 0
--   filas (no-op). Los hijos gatean por el estado del padre. Mismo principio que
--   incidentes (T-062): la inmutabilidad efectiva es "authenticated no muta". NO
--   trigger RAISE EXCEPTION (chocaria con cascade/set-null de sistema — caveat
--   incidentes.sql L14). El cierre corre service-role (bypassa RLS).
-- - APPEND-ONLY / ANULAR: como incidentes — anular = tombstone nuevo
--   (estado='anulada', anulacion=true, corrige_id). Vigencia DERIVADA (vista
--   checklist_executions_vigentes). La INSERT policy de authenticated fuerza
--   estado='borrador' -> solo service-role crea tombstones.
-- - TEMPLATE DE SISTEMA: consultora_id IS NULL = fila de sistema (RGRL), read-only
--   para authenticated (escrita solo por migracion/service-role). SELECT abierto a
--   todo authenticated; INSERT/UPDATE exigen consultora_id IS NOT NULL.
-- - ESTABLECIMIENTO: cliente_id (FK) + columnas snapshot congeladas al cierre
--   (MVP 1-sede-por-cliente, espeja incidentes/empleados). NO tabla establecimientos.
-- - FIRMA: tabla hija execution_firmas (rol matriculado|establecimiento) desde el
--   dia 1; MVP captura solo matriculado. Buckets propios checklist-firmas /
--   checklist-adjuntos (clones de epp-firmas, RLS por foldername[1]=consultora_id).
-- - CAPA -> CALENDARIO: RPC gen_acciones_calendar_for crea el calendar_event
--   (tipo='accion_correctiva' NUEVO, offsets [30,7,0]) Y las filas en
--   calendar_event_reminders (replica computeReminderRows). OJO: la RPC EPP
--   gen_epp_planificaciones_y_calendar_for NO crea reminders (gap latente -> T-114
--   en operativo.md); esta SI los crea, si no el cron nunca dispara.
--
-- RLS: helpers T-015 (is_member_of_consultora / is_owner_of_consultora). NO
-- subqueries inline a consultora_members (los EXISTS a tablas padre del propio
-- modulo — checklist_executions / checklist_template_versions — SI estan permitidos:
-- son logica de dominio, no resolucion de tenancy).
--
-- Tipos: text + CHECK (no enums postgres) en response_type/estado/prioridad/rol —
-- mas facil de extender a C (ALTER CHECK) que ALTER TYPE. Espeja calendar_events.

-- =============================================================================
-- A. TABLAS (9, orden FK)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A.1 checklist_templates (catalogo mutable, system-aware)
-- -----------------------------------------------------------------------------
create table public.checklist_templates (
  id              uuid primary key default gen_random_uuid(),
  -- consultora_id NULL = template de sistema (RGRL). NOT NULL = template del tenant.
  consultora_id   uuid references public.consultoras(id) on delete cascade,
  nombre          text not null check (length(trim(nombre)) between 2 and 200),
  descripcion     text check (descripcion is null or length(descripcion) <= 2000),
  tipo_inspeccion text not null default 'rgrl_463_09'
                  check (tipo_inspeccion in ('rgrl_463_09', 'generico')),
  archived_at     timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.checklist_templates is
  'T-057: cabecera mutable de un template de checklist. consultora_id NULL = '
  'template de sistema (RGRL) read-only; el tenant lo clona para personalizar. '
  'La estructura versionada vive en checklist_template_versions. Soft-delete via '
  'archived_at. tipo_inspeccion abierto (rgrl_463_09 MVP, generico para suite C).';

-- -----------------------------------------------------------------------------
-- A.2 checklist_template_versions (inmutable una vez publicada)
-- -----------------------------------------------------------------------------
create table public.checklist_template_versions (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null references public.checklist_templates(id) on delete cascade,
  -- denormalizado (NULL si sistema): RLS fast-path sin join al template.
  consultora_id  uuid references public.consultoras(id) on delete cascade,
  version_number int not null check (version_number >= 1),
  estado         text not null default 'draft'
                 check (estado in ('draft', 'published', 'archived')),
  published_at   timestamptz,
  published_by   uuid references auth.users(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.checklist_template_versions is
  'T-057: version de un template. La estructura (sections/items) cuelga de aca. '
  'estado draft=editable, published=congelada (la ejecucion la FK), archived=retirada. '
  'Editar un template publicado = clonar a nueva version draft. Inmutabilidad de '
  'published via RLS (sections/items solo editables si la version esta en draft).';

-- -----------------------------------------------------------------------------
-- A.3 template_sections
-- -----------------------------------------------------------------------------
create table public.template_sections (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.checklist_template_versions(id) on delete cascade,
  consultora_id uuid references public.consultoras(id) on delete cascade,
  orden         int not null check (orden >= 0),
  titulo        text not null check (length(trim(titulo)) between 1 and 200),
  descripcion   text check (descripcion is null or length(descripcion) <= 2000),
  created_at    timestamptz not null default now()
);

comment on table public.template_sections is
  'T-057: seccion de una version de template (ej. "Servicio de HyS"). Editable '
  'solo mientras la version padre esta en draft (enforced por RLS).';

-- -----------------------------------------------------------------------------
-- A.4 template_items
-- -----------------------------------------------------------------------------
create table public.template_items (
  id                  uuid primary key default gen_random_uuid(),
  section_id          uuid not null references public.template_sections(id) on delete cascade,
  -- version_id denormalizado: render del form blanco sin doble join + RLS fast-path.
  version_id          uuid not null references public.checklist_template_versions(id) on delete cascade,
  consultora_id       uuid references public.consultoras(id) on delete cascade,
  orden               int not null check (orden >= 0),
  texto               text not null check (length(trim(texto)) between 1 and 1000),
  -- response_type ABIERTO: MVP 4 valores; C agrega multiple_choice/escala via ALTER CHECK.
  response_type       text not null default 'cumple_no_aplica'
                      check (response_type in ('cumple_no_aplica', 'si_no', 'texto', 'numerico')),
  es_critico          boolean not null default false,
  es_requerido        boolean not null default true,
  referencia_normativa text check (referencia_normativa is null or length(referencia_normativa) <= 300),
  -- config: opciones futuras (escala min/max, choices). Reservado para C, NULL en MVP.
  config              jsonb check (config is null or pg_column_size(config) <= 4096),
  created_at          timestamptz not null default now()
);

comment on table public.template_items is
  'T-057: item de una seccion. response_type cumple_no_aplica = SI/NO/N-A (RGRL). '
  'es_critico = incumplirlo fuerza prioridad alta en la CAPA (no bloquea el cierre). '
  'referencia_normativa = cita del articulo (ej. Dec 351/79 Art. 42). config jsonb '
  'reservado para C (escala/choices). Editable solo si la version padre esta en draft.';

-- -----------------------------------------------------------------------------
-- A.5 checklist_executions (append-only tras el cierre)
-- -----------------------------------------------------------------------------
create table public.checklist_executions (
  id                       uuid primary key default gen_random_uuid(),
  consultora_id            uuid not null references public.consultoras(id) on delete cascade,
  -- version exacta que se ejecuto (RESTRICT: no se borra una version con ejecuciones).
  template_version_id      uuid not null references public.checklist_template_versions(id) on delete restrict,
  -- cliente_id = donde se inspecciona (RESTRICT preserva historia). Nullable: borrador
  -- sin cliente asignado todavia.
  cliente_id               uuid references public.clientes(id) on delete restrict,
  -- Snapshot del establecimiento congelado al cierre (D3): el RGRL es documento
  -- legal punto-en-el-tiempo; si el cliente se edita, la inspeccion conserva lo
  -- que era cierto al inspeccionar.
  establecimiento_razon_social text check (establecimiento_razon_social is null or length(establecimiento_razon_social) <= 200),
  establecimiento_cuit         text check (establecimiento_cuit is null or length(establecimiento_cuit) <= 20),
  establecimiento_domicilio    text check (establecimiento_domicilio is null or length(establecimiento_domicilio) <= 200),
  establecimiento_localidad    text check (establecimiento_localidad is null or length(establecimiento_localidad) <= 80),
  establecimiento_provincia    text check (establecimiento_provincia is null or length(establecimiento_provincia) <= 100),
  estado                   text not null default 'borrador'
                           check (estado in ('borrador', 'cerrada', 'anulada')),
  inspector_user_id        uuid references auth.users(id) on delete set null,
  fecha_inspeccion         date,
  gps_lat                  numeric(9, 6) check (gps_lat is null or gps_lat between -90 and 90),
  gps_lng                  numeric(9, 6) check (gps_lng is null or gps_lng between -180 and 180),
  -- Score congelado al cierre (cumple/(cumple+no_cumple), N-A excluido).
  score_cumple             int check (score_cumple is null or score_cumple >= 0),
  score_no_cumple          int check (score_no_cumple is null or score_no_cumple >= 0),
  score_na                 int check (score_na is null or score_na >= 0),
  cumplimiento_pct         numeric(5, 2) check (cumplimiento_pct is null or cumplimiento_pct between 0 and 100),
  tiene_criticos_incumplidos boolean,
  -- sha256 (hex) del PDF Res 463/09 congelado: tamper-evidence ademas de la RLS.
  firma_pdf_hash           text check (firma_pdf_hash is null or firma_pdf_hash ~ '^[0-9a-f]{64}$'),
  cerrada_at               timestamptz,
  -- Supersession (como incidentes): corrige_id + anulacion. Tombstone solo via service-role.
  corrige_id               uuid references public.checklist_executions(id) on delete set null,
  anulacion                boolean not null default false,
  created_by               uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- Una fila cerrada debe tener cerrada_at (evita un flip "desnudo" a cerrada).
  constraint chk_exec_cerrada_tiene_fecha check (
    estado <> 'cerrada' or cerrada_at is not null
  ),
  -- Un tombstone (anulacion) siempre referencia al registro que anula (como incidentes).
  constraint chk_exec_anulacion_requiere_corrige check (
    anulacion = false or corrige_id is not null
  )
);

comment on table public.checklist_executions is
  'T-057: instancia de inspeccion. borrador=mutable (auto-save), cerrada=firmada '
  'e inmutable (freeze por RLS USING estado=borrador), anulada=tombstone. Snapshot '
  'del establecimiento congelado al cierre. Vigencia DERIVADA (vista _vigentes). '
  'template_version_id = que version se ejecuto (versionado inmutable).';

-- -----------------------------------------------------------------------------
-- A.6 execution_respuestas (1 fila por item)
-- -----------------------------------------------------------------------------
create table public.execution_respuestas (
  id                  uuid primary key default gen_random_uuid(),
  execution_id        uuid not null references public.checklist_executions(id) on delete cascade,
  template_item_id    uuid not null references public.template_items(id) on delete restrict,
  consultora_id       uuid not null references public.consultoras(id) on delete cascade,
  -- valor interpretado segun response_type del item: 'si'|'no'|'na' | texto libre.
  valor               text check (valor is null or length(valor) <= 2000),
  valor_numerico      numeric,
  observacion         text check (observacion is null or length(observacion) <= 2000),
  -- fecha del "NO cumple": alimenta la fecha_compromiso de la CAPA.
  fecha_regularizacion date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.execution_respuestas is
  'T-057: respuesta a un item de la inspeccion. UNIQUE(execution_id, '
  'template_item_id) -> auto-save = UPSERT + generacion de CAPAs idempotente. '
  'fecha_regularizacion (en los NO cumple) se inyecta como fecha_compromiso al Calendario.';

-- -----------------------------------------------------------------------------
-- A.7 execution_adjuntos (fotos por item)
-- -----------------------------------------------------------------------------
create table public.execution_adjuntos (
  id            uuid primary key default gen_random_uuid(),
  execution_id  uuid not null references public.checklist_executions(id) on delete cascade,
  -- foto atada (opcionalmente) a un hallazgo puntual.
  respuesta_id  uuid references public.execution_respuestas(id) on delete cascade,
  consultora_id uuid not null references public.consultoras(id) on delete cascade,
  storage_path  text not null check (length(storage_path) between 1 and 500),
  mime_type     text check (mime_type is null or mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes    int check (size_bytes is null or size_bytes between 0 and 10485760),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.execution_adjuntos is
  'T-057: foto de evidencia en bucket checklist-adjuntos, path '
  '<consultora_id>/<execution_id>/<adjunto_id>.<ext>. Editable solo mientras la '
  'ejecucion padre esta en borrador (RLS).';

-- -----------------------------------------------------------------------------
-- A.8 execution_firmas (firmas como tabla hija — D1)
-- -----------------------------------------------------------------------------
create table public.execution_firmas (
  id                 uuid primary key default gen_random_uuid(),
  execution_id       uuid not null references public.checklist_executions(id) on delete cascade,
  consultora_id      uuid not null references public.consultoras(id) on delete cascade,
  rol                text not null check (rol in ('matriculado', 'establecimiento')),
  firma_storage_path text not null check (length(firma_storage_path) between 1 and 500),
  firmante_nombre    text check (firmante_nombre is null or length(trim(firmante_nombre)) between 1 and 200),
  -- matricula del profesional (NULL si rol=establecimiento).
  firmante_matricula text check (firmante_matricula is null or length(firmante_matricula) <= 80),
  firmado_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

comment on table public.execution_firmas is
  'T-057: firma de la inspeccion en bucket checklist-firmas. rol matriculado|'
  'establecimiento (D1): MVP captura solo matriculado; la contrafirma del '
  'establecimiento queda habilitada para C sin migracion. INSERT solo via '
  'service-role (evidencia tamper-proof, como el upload-first de epp-firmas).';

-- -----------------------------------------------------------------------------
-- A.9 acciones_correctivas (CAPA — operacional, MUTABLE)
-- -----------------------------------------------------------------------------
create table public.acciones_correctivas (
  id                uuid primary key default gen_random_uuid(),
  consultora_id     uuid not null references public.consultoras(id) on delete cascade,
  execution_id      uuid not null references public.checklist_executions(id) on delete restrict,
  -- hallazgo origen (NULL si CAPA manual sin item).
  respuesta_id      uuid references public.execution_respuestas(id) on delete set null,
  cliente_id        uuid references public.clientes(id) on delete restrict,
  descripcion       text not null check (length(trim(descripcion)) between 3 and 2000),
  prioridad         text not null default 'media' check (prioridad in ('baja', 'media', 'alta')),
  fecha_compromiso  date not null,
  estado            text not null default 'abierta'
                    check (estado in ('abierta', 'en_progreso', 'cerrada', 'anulada')),
  -- link reverso al evento de calendario (espeja epp_planificaciones.calendar_event_id).
  calendar_event_id uuid references public.calendar_events(id) on delete set null,
  cerrada_at        timestamptz,
  cerrada_por       uuid references auth.users(id) on delete set null,
  evidencia_cierre  text check (evidencia_cierre is null or length(evidencia_cierre) <= 2000),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.acciones_correctivas is
  'T-057: accion correctiva (CAPA) generada de un "NO cumple". MUTABLE (workflow '
  'vivo: abierta->en_progreso->cerrada), a diferencia de la ejecucion inmutable. '
  'fecha_compromiso = fecha_regularizacion del hallazgo -> se inyecta al Calendario '
  '(tipo accion_correctiva) via gen_acciones_calendar_for. calendar_event_id linkea '
  'al evento para reprogramar (updateCalendarEventAction) / cerrar (complete...).';

-- =============================================================================
-- B. INDICES
-- =============================================================================

-- Templates: catalogo del tenant + unicidad de nombre (tenant y sistema por separado).
create unique index idx_checklist_templates_consultora_nombre
  on public.checklist_templates(consultora_id, nombre)
  where archived_at is null;
create unique index idx_checklist_templates_sistema_nombre
  on public.checklist_templates(nombre)
  where consultora_id is null and archived_at is null;
create index idx_checklist_templates_consultora
  on public.checklist_templates(consultora_id)
  where archived_at is null;

-- Versions: numeracion por template + a lo sumo 1 draft abierto por template.
create unique index uq_template_versions_template_number
  on public.checklist_template_versions(template_id, version_number);
create unique index uq_template_versions_one_draft
  on public.checklist_template_versions(template_id)
  where estado = 'draft';

-- Sections / items: orden estable para render.
create unique index uq_template_sections_version_orden
  on public.template_sections(version_id, orden);
create unique index uq_template_items_section_orden
  on public.template_items(section_id, orden);
create index idx_template_items_version
  on public.template_items(version_id);

-- Executions.
create index idx_checklist_exec_consultora_fecha
  on public.checklist_executions(consultora_id, fecha_inspeccion desc);
create index idx_checklist_exec_cliente_fecha
  on public.checklist_executions(cliente_id, fecha_inspeccion desc)
  where cliente_id is not null;
create index idx_checklist_exec_borradores
  on public.checklist_executions(consultora_id)
  where estado = 'borrador';
create index idx_checklist_exec_version
  on public.checklist_executions(template_version_id);
create unique index uq_checklist_exec_corrige
  on public.checklist_executions(corrige_id)
  where corrige_id is not null;

-- Respuestas: 1 por item (UPSERT auto-save + idempotencia CAPA) + lectura del set.
create unique index uq_exec_respuestas_item
  on public.execution_respuestas(execution_id, template_item_id);
create index idx_exec_respuestas_execution
  on public.execution_respuestas(execution_id);

-- Adjuntos.
create index idx_exec_adjuntos_execution
  on public.execution_adjuntos(execution_id);
create index idx_exec_adjuntos_respuesta
  on public.execution_adjuntos(respuesta_id)
  where respuesta_id is not null;

-- Firmas: a lo sumo 1 matriculado por ejecucion.
create unique index uq_exec_firmas_matriculado
  on public.execution_firmas(execution_id)
  where rol = 'matriculado';
create index idx_exec_firmas_execution
  on public.execution_firmas(execution_id);

-- CAPA: el query caliente del gancho = acciones abiertas por consultora + fecha.
create index idx_acciones_abiertas_fecha
  on public.acciones_correctivas(consultora_id, fecha_compromiso)
  where estado in ('abierta', 'en_progreso');
create index idx_acciones_execution
  on public.acciones_correctivas(execution_id);
create index idx_acciones_cliente_estado
  on public.acciones_correctivas(cliente_id, estado)
  where cliente_id is not null;
create unique index uq_acciones_execution_respuesta
  on public.acciones_correctivas(execution_id, respuesta_id)
  where respuesta_id is not null;
create index idx_acciones_calendar_event
  on public.acciones_correctivas(calendar_event_id)
  where calendar_event_id is not null;

-- =============================================================================
-- C. set_updated_at triggers (reusa public.set_updated_at() de T-011)
-- =============================================================================

create trigger set_updated_at_checklist_templates
  before update on public.checklist_templates
  for each row execute function public.set_updated_at();
create trigger set_updated_at_template_versions
  before update on public.checklist_template_versions
  for each row execute function public.set_updated_at();
create trigger set_updated_at_checklist_executions
  before update on public.checklist_executions
  for each row execute function public.set_updated_at();
create trigger set_updated_at_exec_respuestas
  before update on public.execution_respuestas
  for each row execute function public.set_updated_at();
create trigger set_updated_at_acciones_correctivas
  before update on public.acciones_correctivas
  for each row execute function public.set_updated_at();

-- =============================================================================
-- D. AUDIT (AFTER — auditan, no abortan; patron audit_incidentes / audit_clientes)
-- =============================================================================
-- Se auditan las 4 tablas de cabecera/workflow (templates, versions, executions,
-- acciones). Los hijos de alto volumen (sections/items/respuestas/adjuntos/firmas)
-- NO se auditan fila-por-fila: su ciclo queda cubierto por el evento de la cabecera
-- + la inmutabilidad (mismo criterio que EPP audita la entrega, no cada item).

create or replace function public.audit_checklist_templates()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values (new.consultora_id, auth.uid(), 'created', 'checklist_templates', new.id, null,
        jsonb_build_object('nombre', new.nombre, 'tipo_inspeccion', new.tipo_inspeccion, 'consultora_id', new.consultora_id));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.nombre, new.descripcion, new.archived_at) is distinct from (old.nombre, old.descripcion, old.archived_at) then
      insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
        values (new.consultora_id, auth.uid(), 'updated', 'checklist_templates', new.id,
          jsonb_build_object('nombre', old.nombre, 'archived_at', old.archived_at),
          jsonb_build_object('nombre', new.nombre, 'archived_at', new.archived_at));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values (old.consultora_id, auth.uid(), 'deleted', 'checklist_templates', old.id,
        jsonb_build_object('nombre', old.nombre), null);
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_checklist_templates_after_insert after insert on public.checklist_templates
  for each row execute function public.audit_checklist_templates();
create trigger audit_checklist_templates_after_update after update on public.checklist_templates
  for each row execute function public.audit_checklist_templates();
create trigger audit_checklist_templates_after_delete after delete on public.checklist_templates
  for each row execute function public.audit_checklist_templates();

create or replace function public.audit_template_versions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_action text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values (new.consultora_id, auth.uid(), 'created', 'checklist_template_versions', new.id, null,
        jsonb_build_object('template_id', new.template_id, 'version_number', new.version_number, 'estado', new.estado));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.estado is distinct from old.estado then
      -- 'published' es el evento clave (la version queda congelada).
      v_action := case when new.estado = 'published' then 'published' else 'updated' end;
      insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
        values (new.consultora_id, auth.uid(), v_action, 'checklist_template_versions', new.id,
          jsonb_build_object('estado', old.estado), jsonb_build_object('estado', new.estado));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values (old.consultora_id, auth.uid(), 'deleted', 'checklist_template_versions', old.id,
        jsonb_build_object('template_id', old.template_id, 'version_number', old.version_number), null);
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_template_versions_after_insert after insert on public.checklist_template_versions
  for each row execute function public.audit_template_versions();
create trigger audit_template_versions_after_update after update on public.checklist_template_versions
  for each row execute function public.audit_template_versions();
create trigger audit_template_versions_after_delete after delete on public.checklist_template_versions
  for each row execute function public.audit_template_versions();

create or replace function public.audit_checklist_executions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_action text;
begin
  if tg_op = 'INSERT' then
    if new.anulacion then v_action := 'annulled';
    elsif new.corrige_id is not null then v_action := 'corrected';
    else v_action := 'created'; end if;
    insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values (new.consultora_id, auth.uid(), v_action, 'checklist_executions', new.id, null,
        jsonb_build_object('estado', new.estado, 'cliente_id', new.cliente_id,
          'template_version_id', new.template_version_id, 'corrige_id', new.corrige_id, 'anulacion', new.anulacion));
    return new;
  elsif tg_op = 'UPDATE' then
    -- Cierre (borrador->cerrada) = evento clave; otros cambios de estado/score = updated.
    if new.estado is distinct from old.estado or new.cumplimiento_pct is distinct from old.cumplimiento_pct then
      v_action := case when old.estado = 'borrador' and new.estado = 'cerrada' then 'closed' else 'updated' end;
      insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
        values (new.consultora_id, auth.uid(), v_action, 'checklist_executions', new.id,
          jsonb_build_object('estado', old.estado),
          jsonb_build_object('estado', new.estado, 'cumplimiento_pct', new.cumplimiento_pct,
            'tiene_criticos_incumplidos', new.tiene_criticos_incumplidos));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values (old.consultora_id, auth.uid(), 'deleted', 'checklist_executions', old.id,
        jsonb_build_object('estado', old.estado, 'cliente_id', old.cliente_id), null);
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_checklist_executions_after_insert after insert on public.checklist_executions
  for each row execute function public.audit_checklist_executions();
create trigger audit_checklist_executions_after_update after update on public.checklist_executions
  for each row execute function public.audit_checklist_executions();
create trigger audit_checklist_executions_after_delete after delete on public.checklist_executions
  for each row execute function public.audit_checklist_executions();

create or replace function public.audit_acciones_correctivas()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values (new.consultora_id, auth.uid(), 'created', 'acciones_correctivas', new.id, null,
        jsonb_build_object('execution_id', new.execution_id, 'prioridad', new.prioridad,
          'fecha_compromiso', new.fecha_compromiso, 'estado', new.estado));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.estado, new.fecha_compromiso, new.prioridad) is distinct from (old.estado, old.fecha_compromiso, old.prioridad) then
      insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
        values (new.consultora_id, auth.uid(), 'updated', 'acciones_correctivas', new.id,
          jsonb_build_object('estado', old.estado, 'fecha_compromiso', old.fecha_compromiso, 'prioridad', old.prioridad),
          jsonb_build_object('estado', new.estado, 'fecha_compromiso', new.fecha_compromiso, 'prioridad', new.prioridad));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values (old.consultora_id, auth.uid(), 'deleted', 'acciones_correctivas', old.id,
        jsonb_build_object('execution_id', old.execution_id, 'estado', old.estado), null);
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_acciones_correctivas_after_insert after insert on public.acciones_correctivas
  for each row execute function public.audit_acciones_correctivas();
create trigger audit_acciones_correctivas_after_update after update on public.acciones_correctivas
  for each row execute function public.audit_acciones_correctivas();
create trigger audit_acciones_correctivas_after_delete after delete on public.acciones_correctivas
  for each row execute function public.audit_acciones_correctivas();

-- =============================================================================
-- E. RLS (helpers T-015 + system-aware + freeze por RLS)
-- =============================================================================

alter table public.checklist_templates enable row level security;
alter table public.checklist_template_versions enable row level security;
alter table public.template_sections enable row level security;
alter table public.template_items enable row level security;
alter table public.checklist_executions enable row level security;
alter table public.execution_respuestas enable row level security;
alter table public.execution_adjuntos enable row level security;
alter table public.execution_firmas enable row level security;
alter table public.acciones_correctivas enable row level security;

-- -----------------------------------------------------------------------------
-- E.1 Tablas de template (system-aware: consultora_id NULL = sistema read-only)
-- -----------------------------------------------------------------------------

-- checklist_templates
create policy checklist_templates_select on public.checklist_templates
  for select using (
    consultora_id is null or public.is_member_of_consultora(consultora_id)
  );
create policy checklist_templates_insert on public.checklist_templates
  for insert with check (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );
create policy checklist_templates_update on public.checklist_templates
  for update
  using (consultora_id is not null and public.is_member_of_consultora(consultora_id))
  with check (consultora_id is not null and public.is_member_of_consultora(consultora_id));
-- DELETE: sin policy (soft-delete via archived_at).

comment on policy checklist_templates_select on public.checklist_templates is
  'T-057: members ven sus templates + cualquier template de sistema (consultora_id NULL).';
comment on policy checklist_templates_insert on public.checklist_templates is
  'T-057: solo en el propio tenant (consultora_id IS NOT NULL) -> filas de sistema '
  'inescribibles por authenticated (las crea la migracion/service-role).';

-- checklist_template_versions (freeze: published se congela via USING estado='draft')
create policy template_versions_select on public.checklist_template_versions
  for select using (
    consultora_id is null or public.is_member_of_consultora(consultora_id)
  );
create policy template_versions_insert on public.checklist_template_versions
  for insert with check (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
    and estado = 'draft'
  );
-- UPDATE solo sobre versiones draft (una vez published, USING falsea -> 0 filas:
-- no se puede des-publicar ni editar). WITH CHECK permite el flip draft->published.
-- Archivar una version published = service-role (op admin rara).
create policy template_versions_update on public.checklist_template_versions
  for update
  using (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
    and estado = 'draft'
  )
  with check (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
    and estado in ('draft', 'published')
  );

comment on policy template_versions_update on public.checklist_template_versions is
  'T-057: editar solo versiones draft. Una vez published la version queda '
  'congelada (USING estado=draft -> 0 filas) -> editar nunca altera ejecuciones '
  'pasadas (que FK la version). El flip draft->published es one-way para authenticated.';

-- template_sections (editable solo si la version padre esta en draft)
create policy template_sections_select on public.template_sections
  for select using (
    consultora_id is null or public.is_member_of_consultora(consultora_id)
  );
create policy template_sections_insert on public.template_sections
  for insert with check (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.checklist_template_versions v
      where v.id = template_sections.version_id and v.estado = 'draft'
    )
  );
create policy template_sections_update on public.template_sections
  for update
  using (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.checklist_template_versions v
      where v.id = template_sections.version_id and v.estado = 'draft'
    )
  )
  with check (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
  );
create policy template_sections_delete on public.template_sections
  for delete using (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.checklist_template_versions v
      where v.id = template_sections.version_id and v.estado = 'draft'
    )
  );

-- template_items (idem sections; version_id denormalizado -> chequeo directo)
create policy template_items_select on public.template_items
  for select using (
    consultora_id is null or public.is_member_of_consultora(consultora_id)
  );
create policy template_items_insert on public.template_items
  for insert with check (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.checklist_template_versions v
      where v.id = template_items.version_id and v.estado = 'draft'
    )
  );
create policy template_items_update on public.template_items
  for update
  using (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.checklist_template_versions v
      where v.id = template_items.version_id and v.estado = 'draft'
    )
  )
  with check (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
  );
create policy template_items_delete on public.template_items
  for delete using (
    consultora_id is not null
    and public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.checklist_template_versions v
      where v.id = template_items.version_id and v.estado = 'draft'
    )
  );

-- -----------------------------------------------------------------------------
-- E.2 checklist_executions (freeze por RLS: UPDATE solo sobre borrador)
-- -----------------------------------------------------------------------------
create policy checklist_exec_select on public.checklist_executions
  for select using (public.is_member_of_consultora(consultora_id));
-- INSERT: authenticated solo crea borradores frescos (estado=borrador, sin
-- anulacion/corrige) -> los tombstones (anular) solo via service-role.
create policy checklist_exec_insert on public.checklist_executions
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
    and estado = 'borrador'
    and anulacion = false
    and corrige_id is null
  );
-- UPDATE: solo filas borrador (auto-save). Sobre cerrada/anulada -> 0 filas (no-op).
-- WITH CHECK permite el flip a cerrada si el cierre corriera como authenticated;
-- el cierre real corre service-role (bypassa RLS).
create policy checklist_exec_update on public.checklist_executions
  for update
  using (
    public.is_member_of_consultora(consultora_id)
    and estado = 'borrador'
  )
  with check (
    public.is_member_of_consultora(consultora_id)
    and estado = 'borrador'
  );
-- DELETE: sin policy (append-only; purga de tenant via cascade service-role).

comment on policy checklist_exec_update on public.checklist_executions is
  'T-057: FREEZE POR RLS. authenticated solo puede mantener la fila en borrador '
  '(auto-save): USING estado=borrador (un UPDATE sobre cerrada/anulada matchea 0 '
  'filas, no-op) + WITH CHECK estado=borrador (NO puede flipear a cerrada por UPDATE '
  'directo -> no evade la action de cierre, que firma/score/CAPA/reminders). El UNICO '
  'camino a cerrada/anulada es la action service-role (bypassa RLS). Sin trigger RAISE '
  '(chocaria con cascade/set-null de sistema — caveat incidentes.sql L14).';

-- -----------------------------------------------------------------------------
-- E.3 execution_respuestas / execution_adjuntos (gatean por estado del padre)
-- -----------------------------------------------------------------------------
create policy exec_respuestas_select on public.execution_respuestas
  for select using (public.is_member_of_consultora(consultora_id));
create policy exec_respuestas_insert on public.execution_respuestas
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.checklist_executions e
      where e.id = execution_respuestas.execution_id and e.estado = 'borrador'
    )
  );
create policy exec_respuestas_update on public.execution_respuestas
  for update
  using (
    public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.checklist_executions e
      where e.id = execution_respuestas.execution_id and e.estado = 'borrador'
    )
  )
  with check (public.is_member_of_consultora(consultora_id));
create policy exec_respuestas_delete on public.execution_respuestas
  for delete using (
    public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.checklist_executions e
      where e.id = execution_respuestas.execution_id and e.estado = 'borrador'
    )
  );

create policy exec_adjuntos_select on public.execution_adjuntos
  for select using (public.is_member_of_consultora(consultora_id));
create policy exec_adjuntos_insert on public.execution_adjuntos
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.checklist_executions e
      where e.id = execution_adjuntos.execution_id and e.estado = 'borrador'
    )
  );
create policy exec_adjuntos_delete on public.execution_adjuntos
  for delete using (
    public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.checklist_executions e
      where e.id = execution_adjuntos.execution_id and e.estado = 'borrador'
    )
  );

-- -----------------------------------------------------------------------------
-- E.4 execution_firmas (SELECT member; INSERT/UPDATE/DELETE solo service-role)
-- -----------------------------------------------------------------------------
create policy exec_firmas_select on public.execution_firmas
  for select using (public.is_member_of_consultora(consultora_id));
-- Sin INSERT/UPDATE/DELETE: la firma la escribe SOLO la action de cierre via
-- service-role (evidencia tamper-proof, igual que el upload de epp-firmas).

-- -----------------------------------------------------------------------------
-- E.5 acciones_correctivas (mutable: workflow vivo)
-- -----------------------------------------------------------------------------
create policy acciones_select on public.acciones_correctivas
  for select using (public.is_member_of_consultora(consultora_id));
-- INSERT: las genera la RPC (service-role, bypassa). Tambien se permite CAPA manual
-- por un member (futuro), auto-atribuida.
create policy acciones_insert on public.acciones_correctivas
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );
-- UPDATE: member edita el workflow (fecha_compromiso, estado, cierre). NO inmutable.
create policy acciones_update on public.acciones_correctivas
  for update
  using (public.is_member_of_consultora(consultora_id))
  with check (public.is_member_of_consultora(consultora_id));
-- DELETE: sin policy (soft via estado='anulada').

-- =============================================================================
-- F. VISTA checklist_executions_vigentes (head de cada cadena, no anulada)
-- =============================================================================
create view public.checklist_executions_vigentes
  with (security_invoker = true)
as
  select e.*
  from public.checklist_executions e
  where e.anulacion = false
    and not exists (
      select 1 from public.checklist_executions s where s.corrige_id = e.id
    );

comment on view public.checklist_executions_vigentes is
  'T-057: ejecuciones vigentes (head de cada cadena de correcciones, no anuladas). '
  'security_invoker=true -> la RLS de checklist_executions aplica con los permisos '
  'del usuario. Replica el patron de incidentes_vigentes (T-062).';

grant select on public.checklist_executions_vigentes to authenticated, service_role;

-- =============================================================================
-- G. STORAGE BUCKETS (checklist-firmas + checklist-adjuntos) — clones de epp-firmas
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('checklist-firmas', 'checklist-firmas', false, 1048576, array['image/png']),
  ('checklist-adjuntos', 'checklist-adjuntos', false, 10485760,
   array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- RLS de storage.objects: el primer segmento del path = consultora_id (fast-path,
-- patron epp-firmas T-102). SELECT para members; INSERT/UPDATE/DELETE sin policy
-- (service-role only -> el cliente nunca escribe directo al bucket).
create policy "checklist_firmas_read_member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'checklist-firmas'
    and public.is_member_of_consultora((storage.foldername(name))[1]::uuid)
  );
create policy "checklist_adjuntos_read_member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'checklist-adjuntos'
    and public.is_member_of_consultora((storage.foldername(name))[1]::uuid)
  );

-- =============================================================================
-- H. Extension calendar_events.tipo: NUEVO 'accion_correctiva' (D4)
-- =============================================================================
-- El CHECK inline de T-027 se llama calendar_events_tipo_check (nombre canonico
-- de un check de columna). Si difiriera, ajustar el DROP.
alter table public.calendar_events drop constraint calendar_events_tipo_check;
alter table public.calendar_events add constraint calendar_events_tipo_check
  check (tipo in (
    'protocolo_anual', 'epp_entrega', 'capacitacion', 'calibracion',
    'examen_medico', 'rgrl_anual', 'custom', 'accion_correctiva'
  ));

-- =============================================================================
-- I. RPC gen_acciones_calendar_for (crea calendar_event + reminders)
-- =============================================================================
-- Invocada por la action de cierre (T-060) via service-role, DESPUES de generar las
-- acciones_correctivas. NO trigger (los hijos se insertan post-cabecera; el trigger
-- correria con 0 filas — mismo razonamiento que la RPC EPP).
--
-- DIFERENCIA CLAVE vs gen_epp_planificaciones_y_calendar_for: esta SI inserta las
-- filas en calendar_event_reminders (replica computeReminderRows de scheduling.ts).
-- La RPC EPP NO lo hace -> sus vencimientos no disparan el cron (gap latente,
-- T-114 en docs/sprints/operativo.md).
create or replace function public.gen_acciones_calendar_for(p_execution_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exec      record;
  v_accion    record;
  v_event_id  uuid;
  v_offsets   int[] := array[30, 7, 0];  -- cadencia accion_correctiva (D4)
  v_offset    int;
  v_scheduled timestamptz;
  v_titulo    text;
begin
  select id, consultora_id, created_by, establecimiento_razon_social
    into v_exec
    from public.checklist_executions
    where id = p_execution_id;

  if v_exec.id is null then
    raise exception 'checklist_executions % no encontrada', p_execution_id using errcode = '02000';
  end if;

  for v_accion in
    select id, respuesta_id, cliente_id, descripcion, fecha_compromiso
      from public.acciones_correctivas
      where execution_id = p_execution_id
        and calendar_event_id is null
        and estado <> 'anulada'
  loop
    -- titulo <= 200 chars (CHECK calendar_events). >= 3 garantizado por el prefijo.
    v_titulo := left(
      'Acción correctiva RGRL: ' || v_accion.descripcion
        || coalesce(' — ' || v_exec.establecimiento_razon_social, ''),
      200);

    insert into public.calendar_events (
      consultora_id, tipo, titulo, descripcion, fecha_vencimiento,
      reminder_offsets_days, status, created_by, metadata
    ) values (
      v_exec.consultora_id,
      'accion_correctiva',
      v_titulo,
      'Hallazgo de inspección RGRL pendiente de regularización.',
      v_accion.fecha_compromiso,
      v_offsets,
      'pending',
      v_exec.created_by,
      jsonb_build_object(
        'source_module', 'checklists',
        'execution_id', p_execution_id,
        'accion_id', v_accion.id,
        'respuesta_id', v_accion.respuesta_id,
        'cliente_id', v_accion.cliente_id
      )
    )
    returning id into v_event_id;

    update public.acciones_correctivas
      set calendar_event_id = v_event_id
      where id = v_accion.id;

    -- Reminders: scheduled_at = (fecha_compromiso - offset dias) a las 12:00 UTC
    -- (= 09:00 ART, SCHEDULED_AT_SEND_HOUR_UTC). Omite los que cayeron en el pasado.
    foreach v_offset in array v_offsets loop
      v_scheduled := ((v_accion.fecha_compromiso - v_offset)::timestamp + interval '12 hours')
                     at time zone 'UTC';
      if v_scheduled >= now() then
        insert into public.calendar_event_reminders (event_id, consultora_id, offset_days, scheduled_at, status)
          values (v_event_id, v_exec.consultora_id, v_offset, v_scheduled, 'pending')
          on conflict (event_id, offset_days) do nothing;
      end if;
    end loop;
  end loop;
end;
$$;

comment on function public.gen_acciones_calendar_for(uuid) is
  'T-057: por cada accion_correctiva de la ejecucion sin calendar_event_id, crea el '
  'calendar_event (tipo=accion_correctiva, offsets [30,7,0]) + las filas de '
  'calendar_event_reminders (replica computeReminderRows). Idempotente: solo procesa '
  'acciones con calendar_event_id NULL + ON CONFLICT en reminders. service-role only.';

revoke all on function public.gen_acciones_calendar_for(uuid) from public, anon, authenticated;
grant execute on function public.gen_acciones_calendar_for(uuid) to service_role;

-- =============================================================================
-- J. SEED — template de sistema RGRL + 1 seccion PILOTO (valida formato/scoring)
-- =============================================================================
-- ⚠️ CONTENIDO PILOTO, NO LEGAL DEFINITIVO. Las preguntas son RGRL-style estandar
-- para validar el formato end-to-end (response types, es_critico, scoring, orden).
-- Las CITAS NORMATIVAS quedan con placeholder: el matriculado (owner) las verifica.
-- Los ~161 items + citas reales llegan en una migracion de contenido SEPARADA.
-- Corre como owner de la migracion -> bypassa RLS (puede insertar filas de sistema).
do $$
declare
  v_tpl uuid;
  v_ver uuid;
  v_sec uuid;
  c_cita constant text := '(cita pendiente de validación por el matriculado)';
begin
  insert into public.checklist_templates (consultora_id, nombre, descripcion, tipo_inspeccion, created_by)
    values (null,
      'RGRL — Dec. 351/79 (plantilla de sistema)',
      'Relevamiento General de Riesgos Laborales (Res. SRT 463/09, variante Dec. 351/79). '
        || 'Plantilla de sistema read-only: el tenant la clona para personalizar. '
        || 'Sección piloto cargada; contenido completo (~161 ítems) en migración aparte.',
      'rgrl_463_09', null)
    returning id into v_tpl;

  insert into public.checklist_template_versions (template_id, consultora_id, version_number, estado, published_at, published_by, created_by)
    values (v_tpl, null, 1, 'published', now(), null, null)
    returning id into v_ver;

  insert into public.template_sections (version_id, consultora_id, orden, titulo, descripcion)
    values (v_ver, null, 1, 'Servicio de Higiene y Seguridad en el Trabajo',
      'Sección piloto del RGRL (T-057). Valida el formato; contenido a completar.')
    returning id into v_sec;

  insert into public.template_items
    (section_id, version_id, consultora_id, orden, texto, response_type, es_critico, es_requerido, referencia_normativa)
  values
    (v_sec, v_ver, null, 1, '¿El establecimiento cuenta con Servicio de Higiene y Seguridad en el Trabajo?',
      'cumple_no_aplica', true, true, c_cita),
    (v_sec, v_ver, null, 2, '¿El Servicio está dirigido por un graduado universitario matriculado?',
      'cumple_no_aplica', true, true, c_cita),
    (v_sec, v_ver, null, 3, '¿Se cumple con las horas-profesional mensuales según cantidad de trabajadores y nivel de riesgo?',
      'cumple_no_aplica', false, true, c_cita),
    (v_sec, v_ver, null, 4, 'Horas-profesional mensuales asignadas al establecimiento',
      'numerico', false, false, c_cita),
    (v_sec, v_ver, null, 5, '¿El establecimiento cuenta con Servicio de Medicina del Trabajo?',
      'cumple_no_aplica', false, true, c_cita),
    (v_sec, v_ver, null, 6, '¿Se confeccionó el Programa Anual de Prevención de riesgos laborales?',
      'cumple_no_aplica', false, true, c_cita),
    (v_sec, v_ver, null, 7, '¿Se registran las capacitaciones en materia de Higiene y Seguridad?',
      'cumple_no_aplica', false, true, c_cita),
    (v_sec, v_ver, null, 8, 'Observaciones generales del relevamiento del Servicio de HyS',
      'texto', false, false, c_cita);
end $$;
