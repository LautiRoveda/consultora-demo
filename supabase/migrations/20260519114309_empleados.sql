-- T-052 · Modulo Empleados (Sprint 4) — schema base.
--
-- Tabla: public.empleados (primer entity del modulo Empleados).
-- FK obligatorio cliente_id ON DELETE RESTRICT (preserva referential
-- integrity historica para EPP T-058+ y planillas firmadas Res 299/11).
-- Sin server actions ni UI (vienen en T-053 y T-054).
-- Sin tab Empleados en /clientes/[id] (viene en T-055).
--
-- Decisiones vs roadmap:
-- - Sin tabla establecimientos: MVP asume 1 sede por cliente (95% PYME).
--   Multi-sede follow-up con demanda real.
-- - nombre + apellido separados: sort UX argentina por apellido (legajo,
--   planilla EPP). Concatenar al render.
-- - dni text CHECK regex 7-8 digitos sin puntos/guiones. Normalize
--   pre-DB en T-053 server action (strip dots/spaces -> digits only).
-- - cuil text CHECK regex matcheando CUIT format. Opcional (consultor
--   carga DNI primero, completa CUIL al firmar planilla).
-- - fecha_nacimiento + fecha_ingreso opcionales: disparadores de
--   examenes ART (Res SRT 37/10) y capacitacion obligatoria de ingreso
--   (Res SRT 905/15 + Decreto 351/79) para T-058+ EPP.
-- - UNIQUE (consultora_id, cliente_id, dni) WHERE archived_at IS NULL:
--   empleado puede aparecer en 2 clientes distintos del mismo consultor
--   (caso multi-empleo real). Mismo DNI activo en mismo cliente = error
--   data entry. Cross-tenant SI permitido.
-- - Soft-delete via archived_at: rows con archived_at IS NOT NULL no se
--   renderean en UI pero se preservan para audit + historico planillas.
-- - Action de audit_log usa verbos canonicos 'created'/'updated'/
--   'deleted' (patron T-019/T-024/T-027/T-047).
--
-- RLS: helpers T-015 (is_member_of_consultora).
-- - SELECT/INSERT/UPDATE any member (empleados son data compartida).
--   DIFERENCIA con informes (creator OR owner): los empleados NO son
--   "borradores personales" sino fuente de verdad compartida.
-- - DELETE sin policy (default-deny) -> soft-delete via archived_at.

-- =====================================================================
-- Tabla empleados (17 columnas)
-- =====================================================================

create table public.empleados (
  id                  uuid primary key default gen_random_uuid(),
  consultora_id       uuid not null references public.consultoras(id) on delete cascade,
  cliente_id          uuid not null references public.clientes(id) on delete restrict,
  nombre              text not null check (length(trim(nombre)) between 2 and 80),
  apellido            text not null check (length(trim(apellido)) between 2 and 80),
  dni                 text not null check (dni ~ '^\d{7,8}$'),
  cuil                text check (cuil is null or cuil ~ '^\d{2}-\d{8}-\d{1}$'),
  email               text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telefono            text check (telefono is null or length(trim(telefono)) between 6 and 30),
  puesto              text check (puesto is null or length(trim(puesto)) between 2 and 120),
  fecha_ingreso       date,
  fecha_nacimiento    date,
  notas               text check (notas is null or length(notas) <= 2000),
  archived_at         timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.empleados is
  'T-052: tabla maestra de empleados por cliente. FK obligatorio a clientes '
  'ON DELETE RESTRICT (preserva referential integrity para EPP T-058+). '
  'Soft-delete via archived_at. UNIQUE (consultora_id, cliente_id, dni) '
  'only para rows activos. RLS: any member SELECT/INSERT/UPDATE; DELETE '
  'default-deny.';

comment on column public.empleados.dni is
  'T-052: DNI argentino sin puntos ni guiones (7-8 digitos). 7 digitos '
  'legacy pre-2009, 8 digitos actuales. Normalize pre-DB en T-053 server '
  'action (strip dots/spaces -> digits only). Fase 5: tenants chilenos '
  '(RUT) o uruguayos (CI) requieren ajuste del CHECK + migration.';

comment on column public.empleados.cuil is
  'T-052: CUIL formato XX-XXXXXXXX-X (matchea CUIT para personas fisicas). '
  'Opcional porque consultor a veces solo carga DNI primero y completa '
  'CUIL al firmar planilla EPP Res 299/11.';

comment on column public.empleados.fecha_nacimiento is
  'T-052: opcional pero recomendado. Disparador de examenes medicos '
  'periodicos ART (Res SRT 37/10): >40 anios requiere periodicidad anual '
  'vs bianual. Sin esto T-058+ EPP no puede auto-calcular vigencia.';

comment on column public.empleados.fecha_ingreso is
  'T-052: opcional. Disparador de capacitacion obligatoria de ingreso '
  '(Res SRT 905/15 + Decreto 351/79). Permite calendar event auto-creado '
  'al firmar planilla "Capacitacion 30 dias post-ingreso".';

-- =====================================================================
-- Indexes (3 indexes)
-- =====================================================================

-- Index principal: list query del modulo (UI T-054 + tab T-055) con sort
-- por apellido + nombre, scope cliente, solo empleados activos.
create index idx_empleados_cliente_apellido_nombre
  on public.empleados(cliente_id, apellido, nombre)
  where archived_at is null;

-- Index defensivo: queries cross-cliente del mismo tenant (futuro
-- dashboard "empleados totales", busqueda global). RLS scan rapido.
create index idx_empleados_consultora
  on public.empleados(consultora_id)
  where archived_at is null;

-- UNIQUE partial: empleado puede aparecer en 2 clientes distintos del
-- mismo consultor (caso multi-empleo real). Mismo DNI activo en mismo
-- cliente = error data entry. Archive permite re-insertar mismo DNI.
create unique index idx_empleados_consultora_cliente_dni
  on public.empleados(consultora_id, cliente_id, dni)
  where archived_at is null;

-- =====================================================================
-- Trigger updated_at
-- =====================================================================

create trigger set_updated_at_empleados
  before update on public.empleados
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Audit trigger empleados (diff guard sobre 11 fields mutables)
-- =====================================================================

-- 'notas' excluido del guard Y del payload (puede pesar hasta 2 KB, satura
-- audit_log — patron T-047 'notas' / T-027 'descripcion').
create or replace function public.audit_empleados()
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
      (new.consultora_id, auth.uid(), 'created', 'empleados', new.id,
       null,
       jsonb_build_object(
         'cliente_id', new.cliente_id,
         'nombre', new.nombre,
         'apellido', new.apellido,
         'dni', new.dni,
         'cuil', new.cuil,
         'puesto', new.puesto,
         'fecha_ingreso', new.fecha_ingreso
       ));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.cliente_id, new.nombre, new.apellido, new.dni, new.cuil,
        new.email, new.telefono, new.puesto, new.fecha_ingreso,
        new.fecha_nacimiento, new.archived_at)
       is distinct from
       (old.cliente_id, old.nombre, old.apellido, old.dni, old.cuil,
        old.email, old.telefono, old.puesto, old.fecha_ingreso,
        old.fecha_nacimiento, old.archived_at) then
      v_before_payload := jsonb_build_object(
        'cliente_id', old.cliente_id,
        'nombre', old.nombre,
        'apellido', old.apellido,
        'dni', old.dni,
        'cuil', old.cuil,
        'email', old.email,
        'telefono', old.telefono,
        'puesto', old.puesto,
        'fecha_ingreso', old.fecha_ingreso,
        'fecha_nacimiento', old.fecha_nacimiento,
        'archived_at', old.archived_at
      );
      v_after_payload := jsonb_build_object(
        'cliente_id', new.cliente_id,
        'nombre', new.nombre,
        'apellido', new.apellido,
        'dni', new.dni,
        'cuil', new.cuil,
        'email', new.email,
        'telefono', new.telefono,
        'puesto', new.puesto,
        'fecha_ingreso', new.fecha_ingreso,
        'fecha_nacimiento', new.fecha_nacimiento,
        'archived_at', new.archived_at
      );
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'empleados', new.id,
         v_before_payload, v_after_payload);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'empleados', old.id,
       jsonb_build_object(
         'cliente_id', old.cliente_id,
         'nombre', old.nombre,
         'apellido', old.apellido,
         'dni', old.dni,
         'archived_at', old.archived_at
       ),
       null);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_empleados() is
  'T-052: trigger AFTER que escribe a audit_log en INSERT/UPDATE/DELETE '
  'de empleados. Diff guard sobre 11 fields mutables (notas excluido por '
  'tamano, patron T-047 notas). Payload UPDATE incluye snapshot before/'
  'after completo de los 11 fields del guard.';

create trigger audit_empleados_after_insert
  after insert on public.empleados
  for each row execute function public.audit_empleados();

create trigger audit_empleados_after_update
  after update on public.empleados
  for each row execute function public.audit_empleados();

create trigger audit_empleados_after_delete
  after delete on public.empleados
  for each row execute function public.audit_empleados();

-- =====================================================================
-- RLS empleados (3 policies + DELETE default-deny)
-- =====================================================================

alter table public.empleados enable row level security;

create policy empleados_select_own on public.empleados
  for select using (
    public.is_member_of_consultora(consultora_id)
  );

comment on policy empleados_select_own on public.empleados is
  'T-052: cualquier member ve los empleados (data compartida del tenant). '
  'Helper T-015.';

create policy empleados_insert_own on public.empleados
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );

comment on policy empleados_insert_own on public.empleados is
  'T-052: cualquier member puede crear empleados. created_by se valida '
  'igual a auth.uid() para auto-atribuir sin spoof.';

create policy empleados_update_own on public.empleados
  for update
  using (
    public.is_member_of_consultora(consultora_id)
  )
  with check (
    public.is_member_of_consultora(consultora_id)
  );

comment on policy empleados_update_own on public.empleados is
  'T-052: cualquier member puede editar. Diferencia con informes '
  '(creator OR owner): los empleados son fuente de verdad compartida del '
  'tenant. Cualquier tecnico que visita cliente puede actualizar '
  'telefono/puesto del empleado.';

-- DELETE: SIN policy. Default-deny para authenticated. Soft-delete UX
-- via UPDATE archived_at = now(). Hard-delete admin-only via service-role.
