-- T-047 · Modulo Clientes (Sprint 4) — schema base.
--
-- Tabla: public.clientes (primer entity del modulo CRM).
-- Sin server actions ni UI (vienen en T-048 y T-049).
-- Sin integracion con informes / form RGRL (viene en T-050).
--
-- Decisiones vs roadmap:
-- - 15 columnas matcheando data-model.md L302-316 + commonClientFieldsWithSite()
--   de templates (razon_social, cuit, domicilio, localidad, provincia)
--   + campos PYME AR (nombre_fantasia, contacto_*, industria, art, notas).
-- - cuit con CHECK regex AR-specific '^\d{2}-\d{8}-\d{1}$' matcheando el
--   output de normalizeCuit() de src/shared/templates/common/cuit.ts.
--   Comment on column explica Fase 5 (tenants Chile/Uruguay).
-- - provincia text sin enum SQL: UI usa dropdown del enum PROVINCIAS_AR
--   de common/site.ts. Texto libre en DB para abrir a tenants no-AR
--   sin migration en Fase 5.
-- - UNIQUE (consultora_id, cuit) WHERE archived_at IS NULL: dos clientes
--   activos del mismo tenant con mismo CUIT es error de data entry, pero
--   archivar uno y dar de alta otro con mismo CUIT (cambio razon social,
--   fusion) DEBE permitirse. Cross-tenant SI permitido.
-- - Soft-delete via archived_at: rows con archived_at IS NOT NULL no se
--   renderean en UI pero se preservan para audit + historico de informes
--   T-050.
-- - Action de audit_log usa los verbos canonicos 'created'/'updated'/
--   'deleted' (patron T-019/T-024/T-027).
--
-- RLS: helpers T-015 (is_member_of_consultora).
-- - SELECT/INSERT/UPDATE any member de la consultora (clientes son data
--   compartida del tenant — Diego con 5 tecnicos puede coordinar).
--   DIFERENCIA con informes (creator OR owner): los clientes NO son
--   "borradores personales" sino fuente de verdad compartida.
-- - DELETE sin policy (default-deny) -> soft-delete via archived_at.

-- =====================================================================
-- Tabla clientes
-- =====================================================================

create table public.clientes (
  id                  uuid primary key default gen_random_uuid(),
  consultora_id       uuid not null references public.consultoras(id) on delete cascade,
  razon_social        text not null check (length(trim(razon_social)) between 2 and 200),
  cuit                text not null check (cuit ~ '^\d{2}-\d{8}-\d{1}$'),
  nombre_fantasia     text check (nombre_fantasia is null or length(trim(nombre_fantasia)) between 1 and 120),
  domicilio           text check (domicilio is null or length(trim(domicilio)) between 3 and 200),
  localidad           text check (localidad is null or length(trim(localidad)) between 2 and 80),
  provincia           text check (provincia is null or length(provincia) <= 100),
  contacto_nombre     text check (contacto_nombre is null or length(trim(contacto_nombre)) between 2 and 120),
  contacto_email      text check (contacto_email is null or contacto_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contacto_telefono   text check (contacto_telefono is null or length(trim(contacto_telefono)) between 6 and 30),
  industria           text check (industria is null or length(industria) <= 80),
  art                 text check (art is null or length(art) <= 100),
  notas               text check (notas is null or length(notas) <= 2000),
  archived_at         timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.clientes is
  'T-047: tabla maestra de clientes por consultora. Soft-delete via '
  'archived_at. Unique (consultora_id, cuit) only para rows activos. '
  'RLS: any member SELECT/INSERT/UPDATE; DELETE default-deny.';

comment on column public.clientes.cuit is
  'T-047: formato normalizado XX-XXXXXXXX-X (matchea normalizeCuit() de '
  'src/shared/templates/common/cuit.ts). El CHECK regex es AR-specific. '
  'Fase 5: tenants chilenos (RUT XX.XXX.XXX-X) o uruguayos (RUT 12 digitos) '
  'requieren ajuste del CHECK + migration de datos.';

-- =====================================================================
-- Indexes
-- =====================================================================

-- Index principal: list query del modulo (UI T-049) con sort alfabetico
-- por razon_social, scope tenant, solo clientes activos.
create index idx_clientes_consultora_razon_social
  on public.clientes(consultora_id, razon_social)
  where archived_at is null;

-- UNIQUE partial: dos clientes activos del mismo tenant con mismo CUIT
-- es error de data entry. Archive permite re-insertar mismo CUIT.
create unique index idx_clientes_consultora_cuit
  on public.clientes(consultora_id, cuit)
  where archived_at is null;

-- =====================================================================
-- Trigger updated_at
-- =====================================================================

-- Reusa public.set_updated_at() de T-011. Defensa en profundidad:
-- cualquier UPDATE (server action, RPC futura, service-role manual)
-- garantiza updated_at correcto.
create trigger set_updated_at_clientes
  before update on public.clientes
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Audit trigger clientes
-- =====================================================================

-- Diff guard sobre 12 campos mutables. 'notas' excluido del guard pero
-- NO del payload de before/after... espera: 'notas' tampoco va al payload
-- (puede pesar hasta 2 KB; el row de audit_log se mantiene compacto —
-- patron T-027 'descripcion'). Usa variables 'declare' para construir
-- payloads UPDATE (patron T-024).
create or replace function public.audit_clientes()
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
      (new.consultora_id, auth.uid(), 'created', 'clientes', new.id,
       null,
       jsonb_build_object(
         'razon_social', new.razon_social,
         'cuit', new.cuit,
         'nombre_fantasia', new.nombre_fantasia,
         'industria', new.industria,
         'localidad', new.localidad,
         'provincia', new.provincia
       ));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.razon_social, new.cuit, new.nombre_fantasia, new.domicilio,
        new.localidad, new.provincia, new.contacto_nombre,
        new.contacto_email, new.contacto_telefono, new.industria,
        new.art, new.archived_at)
       is distinct from
       (old.razon_social, old.cuit, old.nombre_fantasia, old.domicilio,
        old.localidad, old.provincia, old.contacto_nombre,
        old.contacto_email, old.contacto_telefono, old.industria,
        old.art, old.archived_at) then
      v_before_payload := jsonb_build_object(
        'razon_social', old.razon_social,
        'cuit', old.cuit,
        'nombre_fantasia', old.nombre_fantasia,
        'domicilio', old.domicilio,
        'localidad', old.localidad,
        'provincia', old.provincia,
        'contacto_nombre', old.contacto_nombre,
        'contacto_email', old.contacto_email,
        'contacto_telefono', old.contacto_telefono,
        'industria', old.industria,
        'art', old.art,
        'archived_at', old.archived_at
      );
      v_after_payload := jsonb_build_object(
        'razon_social', new.razon_social,
        'cuit', new.cuit,
        'nombre_fantasia', new.nombre_fantasia,
        'domicilio', new.domicilio,
        'localidad', new.localidad,
        'provincia', new.provincia,
        'contacto_nombre', new.contacto_nombre,
        'contacto_email', new.contacto_email,
        'contacto_telefono', new.contacto_telefono,
        'industria', new.industria,
        'art', new.art,
        'archived_at', new.archived_at
      );
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'clientes', new.id,
         v_before_payload, v_after_payload);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'clientes', old.id,
       jsonb_build_object(
         'razon_social', old.razon_social,
         'cuit', old.cuit,
         'nombre_fantasia', old.nombre_fantasia,
         'archived_at', old.archived_at
       ),
       null);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_clientes() is
  'T-047: trigger AFTER que escribe a audit_log en INSERT/UPDATE/DELETE '
  'de clientes. Diff guard sobre 12 fields mutables (notas excluido por '
  'tamaño, patron T-027 descripcion). Payload UPDATE incluye snapshot '
  'before/after completo de los 12 fields del guard.';

create trigger audit_clientes_after_insert
  after insert on public.clientes
  for each row execute function public.audit_clientes();

create trigger audit_clientes_after_update
  after update on public.clientes
  for each row execute function public.audit_clientes();

create trigger audit_clientes_after_delete
  after delete on public.clientes
  for each row execute function public.audit_clientes();

-- =====================================================================
-- RLS clientes
-- =====================================================================

alter table public.clientes enable row level security;

-- SELECT: cualquier member de la consultora ve todos los clientes del
-- tenant (Diego con 5 tecnicos, coordinacion de equipo).
create policy clientes_select_own on public.clientes
  for select using (
    public.is_member_of_consultora(consultora_id)
  );

comment on policy clientes_select_own on public.clientes is
  'T-047: cualquier member de la consultora ve los clientes (data '
  'compartida del tenant). Helper T-015.';

-- INSERT: member de la consultora, auto-atribuido (no usurpa identidad).
create policy clientes_insert_own on public.clientes
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );

comment on policy clientes_insert_own on public.clientes is
  'T-047: cualquier member puede crear clientes. created_by se valida '
  'igual a auth.uid() para auto-atribuir sin spoof.';

-- UPDATE: any member del tenant (clientes son data compartida, NO
-- gate creator OR owner como informes). Si surge friccion real,
-- hardenear a owner-only.
create policy clientes_update_own on public.clientes
  for update
  using (
    public.is_member_of_consultora(consultora_id)
  )
  with check (
    public.is_member_of_consultora(consultora_id)
  );

comment on policy clientes_update_own on public.clientes is
  'T-047: cualquier member puede editar. Diferencia con informes '
  '(creator OR owner): los clientes son fuente de verdad compartida del '
  'tenant, no borradores personales. Cualquier tecnico que visita puede '
  'updatear telefono/contacto del cliente.';

-- DELETE: SIN policy. Default-deny para authenticated. Soft-delete UX
-- via UPDATE archived_at = now(). Hard-delete admin-only via
-- service-role (cleanup admin / cascade desde consultoras).
