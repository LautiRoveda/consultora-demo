-- T-062 · Modulo Accidentabilidad — libro de incidentes (DB + backend).
--
-- Registra los DOS formatos del libro a nivel REGISTRO en una sola tabla:
--   - tipo='casi_accidente' : evento sin lesion (near miss). Registro interno +
--     investigacion preventiva en texto (causa_raiz + descripcion), SIN IA.
--   - tipo='accidente'      : evento con lesion. Agrega gravedad + dias_perdidos.
-- 'enfermedad' queda FUERA (logica legal propia -> ticket aparte). El workflow de
-- denuncia ART (nro siniestro, plazos, estados, alertas) se DIFIERE a Fase 2+.
--
-- DECISIONES (RFC v2 T-062):
-- - Append-only via RLS: policies SELECT + INSERT, SIN policy UPDATE/DELETE. NO se
--   usa trigger RAISE EXCEPTION (como audit_log/notification_log): chocaria con los
--   FK cascade (consultora_id) y set-null (created_by / informe_id / corrige_id),
--   que disparan UPDATE/DELETE legitimos de sistema. La inmutabilidad efectiva
--   (legalmente suficiente) es que el rol authenticated no puede mutar. Mismo
--   patron que epp_entregas (T-100).
-- - Correccion = registro NUEVO que supersede al anterior via corrige_id. Anulacion
--   = registro tombstone (anulacion=true) que apunta al anulado. NO hay flag
--   'vigente' mutable (la tabla es append-only) -> la vigencia es DERIVADA (vista
--   public.incidentes_vigentes).
-- - Vista incidentes_vigentes con security_invoker=true: corre con permisos del
--   usuario que consulta -> la RLS de incidentes aplica (multi-tenant correcto).
-- - Link opcional informe_id -> informes: el informe IA de investigacion (template
--   accidente, T-022) se genera DESPUES y se vincula. El libro es la fuente de
--   verdad; el informe es artefacto narrativo opcional.
-- - Audit AFTER INSERT/UPDATE/DELETE (auditan, no abortan), replica de
--   audit_epp_entregas (T-100). UPDATE/DELETE solo ocurren por sistema (set-null /
--   cascade) y quedan registrados.
--
-- RLS: helpers T-015 (is_member_of_consultora). NO subqueries inline.
-- FK fantasma 'establecimientos' (data-model.md M10) NO se usa: el ancla "donde
-- ocurrio" es cliente_id (decision MVP 1-sede-por-cliente, ver empleados.sql).

-- =============================================================================
-- A. ENUMS (2)
-- =============================================================================

create type public.tipo_incidente as enum (
  'casi_accidente',
  'accidente'
);

comment on type public.tipo_incidente is
  'T-062: tipo de registro del libro de incidentes. casi_accidente=evento sin '
  'lesion (near miss, registro preventivo), accidente=evento con lesion. '
  'enfermedad profesional queda fuera (logica legal propia, ticket aparte).';

create type public.gravedad_incidente as enum (
  'leve',
  'grave',
  'mortal'
);

comment on type public.gravedad_incidente is
  'T-062: gravedad del accidente con lesion. leve=sin baja prolongada, '
  'grave=baja prolongada, mortal=fatalidad. Distinguir mortal de grave es '
  'necesario para indices IF/IG (Fase 4) y para reporte ART. Solo aplica a '
  'tipo=accidente (NULL en casi_accidente, enforced por CHECK).';

-- =============================================================================
-- B. TABLA (incidentes)
-- =============================================================================

create table public.incidentes (
  id                uuid primary key default gen_random_uuid(),
  consultora_id     uuid not null references public.consultoras(id) on delete cascade,
  -- cliente_id = "donde ocurrio" (ancla de sede). Nullable: un casi-accidente
  -- puede no estar atado a un cliente puntual. ON DELETE RESTRICT preserva
  -- integridad historica (no se borra un cliente con incidentes).
  cliente_id        uuid references public.clientes(id) on delete restrict,
  -- empleado_id = victima. Nullable: visitante / contratista / tercero, o
  -- casi-accidente sin victima. ON DELETE RESTRICT (integridad historica).
  empleado_id       uuid references public.empleados(id) on delete restrict,
  tipo              public.tipo_incidente not null,
  fecha             date not null,
  hora              time,
  lugar_especifico  text check (lugar_especifico is null or length(trim(lugar_especifico)) between 3 and 200),
  descripcion       text not null check (length(trim(descripcion)) between 10 and 4000),
  -- causa_raiz = investigacion preventiva (texto libre, SIN IA). Clave en
  -- casi-accidentes; opcional en accidentes (puede venir luego en el informe).
  causa_raiz        text check (causa_raiz is null or length(trim(causa_raiz)) between 1 and 4000),
  accion_inmediata  text check (accion_inmediata is null or length(trim(accion_inmediata)) between 1 and 2000),
  -- gravedad / dias_perdidos: solo accidente-con-lesion (ver CHECK abajo).
  gravedad          public.gravedad_incidente,
  dias_perdidos     int check (dias_perdidos is null or dias_perdidos between 0 and 3650),
  -- Link OPCIONAL al informe IA de investigacion (template accidente T-022).
  -- ON DELETE SET NULL: si se borra el informe, el incidente sobrevive sin link.
  informe_id        uuid references public.informes(id) on delete set null,
  -- Supersession: este registro corrige/anula al referenciado. UNIQUE parcial
  -- (uq_incidentes_corrige) garantiza cadena lineal (sin forks). ON DELETE SET
  -- NULL (no RESTRICT) para no bloquear la purga de un tenant: el unico DELETE
  -- posible es el cascade de consultora; RESTRICT podria fallar por orden de
  -- borrado dentro del cascade. Single-row delete no ocurre (sin policy DELETE).
  corrige_id        uuid references public.incidentes(id) on delete set null,
  anulacion         boolean not null default false,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),

  -- Coherencia tipo <-> severidad a nivel DB (defensa ademas del Zod):
  --   accidente      -> gravedad obligatoria.
  --   casi_accidente -> gravedad NULL y sin dias_perdidos (no hubo lesion).
  constraint incidentes_gravedad_por_tipo check (
    (tipo = 'accidente' and gravedad is not null)
    or (tipo = 'casi_accidente' and gravedad is null and (dias_perdidos is null or dias_perdidos = 0))
  ),

  -- Un registro de anulacion siempre referencia al registro que anula.
  constraint incidentes_anulacion_requiere_corrige check (
    anulacion = false or corrige_id is not null
  )
);

comment on table public.incidentes is
  'T-062: libro de incidentes (casi_accidente | accidente). Append-only via RLS '
  '(SELECT + INSERT, sin UPDATE/DELETE). Correccion = registro nuevo con '
  'corrige_id; anulacion = tombstone anulacion=true. Vigencia DERIVADA (vista '
  'incidentes_vigentes). cliente_id = donde ocurrio; empleado_id = victima '
  '(ambos nullable). informe_id = link opcional al informe IA de investigacion.';

comment on column public.incidentes.corrige_id is
  'T-062: registro que este corrige/anula (supersession). UNIQUE parcial -> '
  'cadena lineal sin forks. NULL en altas.';
comment on column public.incidentes.anulacion is
  'T-062: true = este registro ANULA a corrige_id (cargado por error, sin '
  'reemplazo con datos). Se setea en el INSERT y no se modifica.';
comment on column public.incidentes.gravedad is
  'T-062: solo tipo=accidente (NULL en casi_accidente, CHECK incidentes_gravedad_por_tipo).';

-- =============================================================================
-- C. INDICES
-- =============================================================================

create index idx_incidentes_consultora_fecha
  on public.incidentes(consultora_id, fecha desc);

create index idx_incidentes_cliente_fecha
  on public.incidentes(cliente_id, fecha desc)
  where cliente_id is not null;

create index idx_incidentes_empleado
  on public.incidentes(empleado_id)
  where empleado_id is not null;

create index idx_incidentes_informe
  on public.incidentes(informe_id)
  where informe_id is not null;

-- Cadena lineal de correcciones: un registro se corrige a lo sumo una vez.
create unique index uq_incidentes_corrige
  on public.incidentes(corrige_id)
  where corrige_id is not null;

-- =============================================================================
-- D. RLS (helpers T-015 — append-only: SELECT + INSERT, sin UPDATE/DELETE)
-- =============================================================================

alter table public.incidentes enable row level security;

create policy incidentes_select_own on public.incidentes
  for select using (public.is_member_of_consultora(consultora_id));

create policy incidentes_insert_own on public.incidentes
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );

comment on policy incidentes_select_own on public.incidentes is
  'T-062: any member del tenant ve el libro (data compartida — cualquier tecnico '
  'debe ver el historico de incidentes).';
comment on policy incidentes_insert_own on public.incidentes is
  'T-062: any member registra incidentes, auto-atribuido via created_by=auth.uid(). '
  'La validacion cross-tenant de cliente_id/empleado_id/informe_id se hace en la '
  'server action (la RLS solo valida el consultora_id de la fila).';

-- UPDATE: SIN policy. DELETE: SIN policy. Append-only (default-deny para
-- authenticated). Las mutaciones de sistema (cascade al purgar consultora;
-- set-null al borrar user/informe) ocurren como owner/service_role y quedan
-- auditadas (seccion E).

-- =============================================================================
-- E. AUDIT (AFTER — auditan, no abortan; replica de audit_epp_entregas)
-- =============================================================================

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
    -- Solo ocurre por sistema (on delete set null de informe_id / created_by).
    -- authenticated no tiene UPDATE policy.
    if (new.informe_id, new.created_by) is distinct from (old.informe_id, old.created_by) then
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'incidentes', new.id,
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
  'T-062: trigger AFTER que escribe a audit_log. INSERT -> created/corrected/annulled '
  'segun corrige_id/anulacion. UPDATE/DELETE solo por sistema (set-null/cascade) y '
  'quedan registrados. PII: solo referencia empleado_id (uuid), nunca nombre/DNI. '
  'Replica el patron de audit_epp_entregas (T-100).';

create trigger audit_incidentes_after_insert
  after insert on public.incidentes
  for each row execute function public.audit_incidentes();
create trigger audit_incidentes_after_update
  after update on public.incidentes
  for each row execute function public.audit_incidentes();
create trigger audit_incidentes_after_delete
  after delete on public.incidentes
  for each row execute function public.audit_incidentes();

-- =============================================================================
-- F. VISTA incidentes_vigentes (registro vigente = head de cada cadena)
-- =============================================================================

-- security_invoker=true: la vista corre con los permisos del usuario que la
-- consulta, por lo que la RLS de incidentes aplica (multi-tenant correcto). Sin
-- esto, la vista correria como su owner y filtraria mal. Requiere Postgres 15+.
create view public.incidentes_vigentes
  with (security_invoker = true)
as
  select i.*
  from public.incidentes i
  where i.anulacion = false
    and not exists (
      select 1 from public.incidentes s where s.corrige_id = i.id
    );

comment on view public.incidentes_vigentes is
  'T-062: registros vigentes del libro (head de cada cadena de correcciones). '
  'Un registro es vigente si NO es anulacion y ningun otro lo supersede via '
  'corrige_id. security_invoker=true -> la RLS de incidentes aplica con los '
  'permisos del usuario que consulta. queries.ts (getIncidentes) lee de aca.';

grant select on public.incidentes_vigentes to authenticated, service_role;
