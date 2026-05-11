-- T-019 · Modulo Informes (primer ticket de Sprint 2).
--
-- Tabla `public.informes` + RLS multi-tenant + audit log triggers.
-- Sienta patron para los modulos siguientes (Clientes, Empleados, EPP, ...):
-- - Tabla con `consultora_id` + RLS habilitado dia 1.
-- - Policies SELECT/INSERT/UPDATE usando los helpers de T-015. NO subqueries
--   inline a `consultora_members`.
-- - Sin policy DELETE para authenticated (hard-delete solo via service-role).
--   Soft-delete UX = UPDATE status='archived'.
-- - Triggers AFTER INSERT/UPDATE/DELETE que escriben a `public.audit_log`
--   cumpliendo el contrato declarado en tenancy.sql linea 237-238.
--
-- Tipos validos a dia 1 (snake_case): relevamiento | capacitacion | rgrl
-- | accidente | otros. Ampliable con alter table check sin migracion pesada.
--
-- Constantes TS espejo viven en src/app/(app)/informes/schema.ts y deben
-- mantenerse en sync con los check constraints.


-- =============================================================================
-- TABLA
-- =============================================================================

create table public.informes (
  id            uuid primary key default gen_random_uuid(),
  consultora_id uuid not null references public.consultoras(id) on delete cascade,
  tipo          text not null
                check (tipo in ('relevamiento','capacitacion','rgrl','accidente','otros')),
  titulo        text not null check (length(trim(titulo)) between 3 and 200),
  contenido     text,
  status        text not null default 'draft'
                check (status in ('draft','published','archived')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.informes is
  'Informes tecnicos HyS. T-019 crea metadata + status; contenido se llena en T-020+ (generacion con Claude API).';
comment on column public.informes.tipo is
  'Tipo de informe. relevamiento|capacitacion|rgrl|accidente|otros. Ampliable via alter constraint.';
comment on column public.informes.status is
  'draft (en edicion) | published (firmado por el profesional) | archived (soft-delete UX).';
comment on column public.informes.contenido is
  'Cuerpo del informe. NULL en T-019 (sin editor). T-020 lo llena con markdown / json estructurado.';
comment on column public.informes.created_by is
  'User que creo el informe. NULL si el user fue borrado (preserva historial via on delete set null).';


-- =============================================================================
-- INDEXES
-- =============================================================================
-- Indexes day-1: query principal (lista de la consultora ordenada desc) + filtro
-- por status. NO indexamos created_by todavia (vista "mis informes" no existe en T-019).

create index idx_informes_consultora_created
  on public.informes(consultora_id, created_at desc);

create index idx_informes_consultora_status
  on public.informes(consultora_id, status);


-- =============================================================================
-- TRIGGERS DE METADATA
-- =============================================================================

create trigger set_updated_at_informes
  before update on public.informes
  for each row execute function public.set_updated_at();


-- =============================================================================
-- AUDIT TRIGGER (T-019)
-- =============================================================================
-- Cumple promesa de tenancy.sql:237-238 ("audit_log INSERT solo via triggers
-- AFTER en tablas de dominio T-019/T-020"). Establece el patron que copian
-- las tablas futuras del dominio (clientes, empleados, epp, ...).
--
-- - security definer + search_path = '': bypasea la falta de policy INSERT en
--   audit_log (default-deny para authenticated). Sin esto, el trigger fallaria
--   cuando lo dispara una server action con session cookie (RLS aplica).
-- - auth.uid() captura el actor desde el JWT del request original. NULL cuando
--   la mutation viene de service-role sin JWT context (jobs admin).
-- - Diff guard `is distinct from` evita rows de audit cuando el UPDATE solo
--   toca updated_at o contenido (T-020+ va a sumar contenido al diff).
-- - INSERT/UPDATE/DELETE estan separados: TG_OP rama la logica para que el
--   payload jsonb tenga el shape correcto por operacion.

create or replace function public.audit_informes()
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
      (new.consultora_id, auth.uid(), 'created', 'informes', new.id,
       null,
       jsonb_build_object('tipo', new.tipo, 'titulo', new.titulo, 'status', new.status));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.titulo, new.tipo, new.status) is distinct from (old.titulo, old.tipo, old.status) then
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'informes', new.id,
         jsonb_build_object('titulo', old.titulo, 'tipo', old.tipo, 'status', old.status),
         jsonb_build_object('titulo', new.titulo, 'tipo', new.tipo, 'status', new.status));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'informes', old.id,
       jsonb_build_object('titulo', old.titulo, 'tipo', old.tipo, 'status', old.status),
       null);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_informes() is
  'T-019: trigger AFTER que escribe a audit_log en INSERT/UPDATE/DELETE de informes. security definer para bypasear default-deny de audit_log. Patron a copiar en tablas de dominio futuras.';

create trigger audit_informes_after_insert
  after insert on public.informes
  for each row execute function public.audit_informes();

create trigger audit_informes_after_update
  after update on public.informes
  for each row execute function public.audit_informes();

create trigger audit_informes_after_delete
  after delete on public.informes
  for each row execute function public.audit_informes();


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.informes enable row level security;

-- SELECT: cualquier member ve los informes de su consultora.
create policy informes_select_own on public.informes
  for select using (
    public.is_member_of_consultora(consultora_id)
  );

-- INSERT: member de la consultora puede crear, atribuido a si mismo.
-- with check valida que consultora_id apunta a una consultora donde es member
-- y que no esta seteando created_by ajeno.
create policy informes_insert_own on public.informes
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );

-- UPDATE: el creator del informe O el owner de la consultora.
-- using gobierna que filas puede tocar; with check valida que el row resultante
-- sigue cumpliendo (bloquea cross-tenant + cambio de created_by).
create policy informes_update_own_or_owner on public.informes
  for update
  using (
    public.is_member_of_consultora(consultora_id)
    and (
      created_by = auth.uid()
      or public.is_owner_of_consultora(consultora_id)
    )
  )
  with check (
    public.is_member_of_consultora(consultora_id)
    and (
      created_by = auth.uid()
      or public.is_owner_of_consultora(consultora_id)
    )
  );

-- DELETE: SIN policy. Default-deny para authenticated. Hard-delete solo via
-- service-role (admin jobs). El audit trigger captura igual esos DELETEs.

comment on policy informes_select_own on public.informes is
  'T-019: SELECT por membership. Usa helper is_member_of_consultora (fast-path JWT claim + fallback DB).';
comment on policy informes_insert_own on public.informes is
  'T-019: INSERT por member en su consultora, atribuido a si mismo via created_by=auth.uid().';
comment on policy informes_update_own_or_owner on public.informes is
  'T-019: UPDATE por creator del informe O owner de la consultora. Bloquea cross-tenant + cambio de created_by.';
