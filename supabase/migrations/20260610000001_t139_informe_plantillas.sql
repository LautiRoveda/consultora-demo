-- T-139: plantillas guardables de personalizacion de informes ("Mis plantillas").
-- Fase 3 de templates moldeables. La config de personalizacion de fases 1+2
-- (campos_personalizados / instrucciones_adicionales / secciones) se guarda
-- como preset reutilizable per-consultora y se COPIA al informe al aplicar
-- (snapshot-on-apply: editar o archivar la plantilla nunca toca informes ya
-- creados — la config aplicada vive en informe_metadata.data).
--
-- Decisiones (RFC T-139):
-- - RLS PER-CONSULTORA (a diferencia del chat T-126, privado per-user): las
--   plantillas son activos del negocio, cualquier member las lista/aplica/edita.
-- - SIN audit triggers: preset de configuracion UX, no dominio legal. El
--   artefacto con valor legal es el informe, donde la config queda copiada.
-- - check de config estructural minimo (jsonb_typeof = 'object'): validar el
--   shape per-tipo en SQL exigiria duplicar el catalogo de secciones TS en la
--   DB. La validacion real vive en Zod en el borde (PLANTILLA_CONFIG_SCHEMA_BY_TIPO,
--   strict: rechaza datos del cliente y secciones de otro tipo).

create table public.informe_plantillas (
  id            uuid primary key default gen_random_uuid(),
  consultora_id uuid not null references public.consultoras(id) on delete cascade,
  -- Espeja el check de informes.tipo (20260511232802_informes.sql).
  tipo          text not null
                check (tipo in ('relevamiento','capacitacion','rgrl','accidente','otros')),
  nombre        text not null check (length(trim(nombre)) between 1 and 80),
  config        jsonb not null check (jsonb_typeof(config) = 'object'),
  -- Atribucion, no ownership: la plantilla es de la consultora y sobrevive a
  -- la baja del user que la creo (molde clientes T-047).
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

comment on table public.informe_plantillas is
  'T-139: presets de personalizacion de informes por consultora. '
  'Snapshot-on-apply (la config se copia a informe_metadata al aplicar; sin '
  'FK informe->plantilla). Soft-delete via archived_at. RLS: any member '
  'SELECT/INSERT/UPDATE; DELETE default-deny.';

comment on column public.informe_plantillas.config is
  'Shape per-tipo validado en el borde (Zod strict): campos_personalizados? / '
  'instrucciones_adicionales? / secciones? (solo tipos configurables). '
  'ESTRUCTURA, nunca datos del cliente (razon_social/cuit son por-informe).';

-- Index lista/selector: plantillas activas de un tipo, orden alfabetico.
create index idx_informe_plantillas_lista
  on public.informe_plantillas(consultora_id, tipo, nombre)
  where archived_at is null;

-- UNIQUE parcial: dos plantillas activas del mismo tipo con igual nombre
-- (case-insensitive) confunden al seleccionar. Archivar libera el nombre.
create unique index idx_informe_plantillas_nombre
  on public.informe_plantillas(consultora_id, tipo, lower(nombre))
  where archived_at is null;

-- Reusa public.set_updated_at() (T-011, 20260511000615_tenancy.sql).
create trigger set_updated_at_informe_plantillas
  before update on public.informe_plantillas
  for each row execute function public.set_updated_at();

alter table public.informe_plantillas enable row level security;

-- Helpers T-015 (regla forward): nada de subqueries inline a consultora_members.

create policy informe_plantillas_select_members on public.informe_plantillas
  for select using (
    public.is_member_of_consultora(consultora_id)
  );

create policy informe_plantillas_insert_members on public.informe_plantillas
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );

comment on policy informe_plantillas_insert_members on public.informe_plantillas is
  'T-139: cualquier member crea plantillas. created_by se valida igual a '
  'auth.uid() para auto-atribuir sin spoof.';

create policy informe_plantillas_update_members on public.informe_plantillas
  for update
  using (public.is_member_of_consultora(consultora_id))
  with check (public.is_member_of_consultora(consultora_id));

-- DELETE: sin policy (default-deny para authenticated). Soft-delete UX via
-- UPDATE archived_at = now(); hard-delete solo service-role (cleanup admin /
-- cascade desde consultoras).

grant select, insert, update on public.informe_plantillas to authenticated;
grant all on public.informe_plantillas to service_role;
