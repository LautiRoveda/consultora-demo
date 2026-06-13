-- T-143 · RAR Fase 1 — Catálogo de agentes de riesgo (Dto 658/96) + modelo de
-- exposición puesto×agente.
--
-- Épica RAR (Relevamiento de Agentes de Riesgo): la DJ anual que el empleador
-- presenta a su ART declarando trabajadores expuestos a agentes de riesgo
-- (Dto 658/96 + Res SRT 37/2010). Fase 1 = SOLO catálogo + modelo de exposición.
-- Sin nómina PDF (Fase 2) ni vencimiento en calendario (Fase 3).
--
-- Decisiones cerradas (orquestador, validadas contra el código):
-- 1. cliente = establecimiento en el MVP (clientes ya tiene domicilio/localidad/
--    provincia/art). No se modela `establecimientos`.
-- 2. Catálogo NUEVO `rar_agentes` — separado de AGENTES_HYS de relevamiento
--    (esa es la lista de MEDICIÓN del informe técnico, otro concepto). SRP.
-- 3. Exposición a nivel PUESTO (junction puesto×agente). El empleado hereda la
--    unión de agentes de sus puestos vía empleados_puestos. Sin override por
--    empleado (fase posterior).
-- 4. La junction nace con FK COMPUESTAS Ring A (ADR-0015 / T-121): coherencia
--    consultora_id estructural entre la junction y ambos parents.
-- 5. `rar_agentes` per-consultora, seedeado idempotente owner-only desde const TS
--    (T-143 seedDefaultCatalogAction). El seed NO asigna agentes a puestos.
-- 6. agente_tipo = enum cerrado de 4 (fisico|quimico|biologico|ergonomico).
--    Mapeo de la taxonomía clásica HyS sobre el TIPO de la Res SRT 81/2019
--    (Anexo III, ESOP): QUIMICOS→quimico, BIOLOGICOS→biologico, FISICOS→fisico,
--    y el grupo TERMOHIGROMETRICOS Y OTROS se reparte entre fisico (calor,
--    presión) y ergonomico (posiciones forzadas, carga lumbosacra, voz).
--
-- RLS: helpers T-015 (is_member_of_consultora).
-- - rar_agentes (catálogo): any member SELECT/INSERT/UPDATE; NO DELETE
--   (soft-delete via archived_at). El corte a owner es de la capa action
--   (requireOwner), igual que epp_categorias.
-- - puesto_agentes (junction): any member SELECT/INSERT/DELETE; NO UPDATE
--   (las asignaciones se borran/reinsertan, como empleados_puestos).
--
-- Aditiva pura: no toca tablas existentes. puestos ya tiene
-- unique(id, consultora_id) (puestos_id_consultora_id_key, T-121) → la FK
-- compuesta a puestos va directa, sin do-block de retrofit.

-- =============================================================================
-- A. ENUM (1)
-- =============================================================================

create type public.agente_riesgo_tipo as enum (
  'fisico',
  'quimico',
  'biologico',
  'ergonomico'
);

comment on type public.agente_riesgo_tipo is
  'T-143: clasificación del agente de riesgo (Dto 658/96, taxonomía clásica HyS). '
  'fisico=ruido/vibraciones/radiaciones/calor/presión, quimico=polvos/gases/'
  'humos/solventes, biologico=virus/bacterias/hongos/parásitos, '
  'ergonomico=posiciones forzadas/manipulación de cargas/uso de la voz.';

-- =============================================================================
-- B. TABLAS (2, orden FK)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B.1 rar_agentes (catálogo per-consultora, soft-delete via archived_at)
-- -----------------------------------------------------------------------------

create table public.rar_agentes (
  id                  uuid primary key default gen_random_uuid(),
  consultora_id       uuid not null references public.consultoras(id) on delete cascade,
  codigo              text not null check (length(trim(codigo)) between 2 and 60),
  nombre              text not null check (length(trim(nombre)) between 2 and 120),
  agente_tipo         public.agente_riesgo_tipo not null,
  cas                 text check (cas is null or length(trim(cas)) <= 40),
  enfermedad_asociada text check (enfermedad_asociada is null or length(enfermedad_asociada) <= 200),
  descripcion         text check (descripcion is null or length(descripcion) <= 500),
  archived_at         timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Destino Ring A: la FK compuesta de puesto_agentes referencia (id, consultora_id).
  constraint rar_agentes_id_consultora_id_key unique (id, consultora_id)
);

comment on table public.rar_agentes is
  'T-143: catálogo de agentes de riesgo por consultora (Dto 658/96). Seedeado '
  'idempotente owner-only desde const TS con los códigos ESOP reales de la Res '
  'SRT 81/2019 (Anexo III). Soft-delete via archived_at. codigo = natural key '
  'del seed (idempotencia).';

comment on column public.rar_agentes.codigo is
  'T-143: código ESOP del agente (Res SRT 81/2019, ej. 90001=Ruido, '
  '40153=Sílice cristalina). Natural key del seed idempotente. Editable por el '
  'consultor para agentes propios fuera del listado.';

comment on column public.rar_agentes.cas is
  'T-143: número CAS del agente químico (orientativo). NULL para agentes sin '
  'CAS (físicos, biológicos, ergonómicos, o químicos sin CAS asignado en el '
  'Anexo III).';

-- codigo = natural key del seed → unique activo (idempotencia sin ON CONFLICT).
create unique index idx_rar_agentes_codigo
  on public.rar_agentes(consultora_id, codigo)
  where archived_at is null;

-- nombre unico activo (UX, como epp_categorias).
create unique index idx_rar_agentes_nombre
  on public.rar_agentes(consultora_id, nombre)
  where archived_at is null;

create index idx_rar_agentes_consultora
  on public.rar_agentes(consultora_id)
  where archived_at is null;

-- -----------------------------------------------------------------------------
-- B.2 puesto_agentes (junction M:N, FK COMPUESTAS Ring A)
-- -----------------------------------------------------------------------------

-- consultora_id denormalizado para RLS fast-path sin join a los parents (mismo
-- trade-off que empleados_puestos / calendar_event_reminders). Las FK compuestas
-- garantizan que el puesto Y el agente pertenecen a la MISMA consultora que la
-- fila junction (coherencia estructural Ring A, ADR-0015).
create table public.puesto_agentes (
  puesto_id     uuid not null,
  agente_id     uuid not null,
  consultora_id uuid not null references public.consultoras(id) on delete cascade,
  asignado_at   timestamptz not null default now(),
  asignado_por  uuid references auth.users(id) on delete set null,
  primary key (puesto_id, agente_id),
  constraint puesto_agentes_puesto_consultora_fkey
    foreign key (puesto_id, consultora_id)
    references public.puestos(id, consultora_id) on delete cascade,
  constraint puesto_agentes_agente_consultora_fkey
    foreign key (agente_id, consultora_id)
    references public.rar_agentes(id, consultora_id) on delete cascade
);

comment on table public.puesto_agentes is
  'T-143: junction M:N puesto <-> agente de riesgo (exposición). El empleado '
  'hereda la unión de agentes de sus puestos (empleados_puestos). FK compuestas '
  'Ring A: puesto y agente deben ser de la misma consultora que la fila. '
  'consultora_id denormalizado para RLS fast-path.';

create index idx_puesto_agentes_agente
  on public.puesto_agentes(agente_id);

create index idx_puesto_agentes_consultora
  on public.puesto_agentes(consultora_id);

-- =============================================================================
-- C. TRIGGER set_updated_at (solo rar_agentes tiene updated_at)
-- =============================================================================

create trigger set_updated_at_rar_agentes
  before update on public.rar_agentes
  for each row execute function public.set_updated_at();

-- puesto_agentes: junction sin updated_at (se borra/reinserta, sin trigger).

-- =============================================================================
-- D. AUDIT TRIGGERS (2 funciones + 5 triggers)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- D.1 audit_rar_agentes (created/updated/deleted, diff guard is distinct from)
-- -----------------------------------------------------------------------------

create or replace function public.audit_rar_agentes()
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
      (new.consultora_id, auth.uid(), 'created', 'rar_agentes', new.id,
       null,
       jsonb_build_object('codigo', new.codigo, 'nombre', new.nombre,
                          'agente_tipo', new.agente_tipo));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.codigo, new.nombre, new.agente_tipo, new.cas, new.enfermedad_asociada,
        new.descripcion, new.archived_at)
       is distinct from
       (old.codigo, old.nombre, old.agente_tipo, old.cas, old.enfermedad_asociada,
        old.descripcion, old.archived_at) then
      v_before_payload := jsonb_build_object(
        'codigo', old.codigo, 'nombre', old.nombre, 'agente_tipo', old.agente_tipo,
        'cas', old.cas, 'enfermedad_asociada', old.enfermedad_asociada,
        'descripcion', old.descripcion, 'archived_at', old.archived_at);
      v_after_payload := jsonb_build_object(
        'codigo', new.codigo, 'nombre', new.nombre, 'agente_tipo', new.agente_tipo,
        'cas', new.cas, 'enfermedad_asociada', new.enfermedad_asociada,
        'descripcion', new.descripcion, 'archived_at', new.archived_at);
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'rar_agentes', new.id,
         v_before_payload, v_after_payload);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'rar_agentes', old.id,
       jsonb_build_object('codigo', old.codigo, 'nombre', old.nombre,
                          'archived_at', old.archived_at),
       null);
    return old;
  end if;
  return null;
end;
$$;

create trigger audit_rar_agentes_after_insert
  after insert on public.rar_agentes
  for each row execute function public.audit_rar_agentes();
create trigger audit_rar_agentes_after_update
  after update on public.rar_agentes
  for each row execute function public.audit_rar_agentes();
create trigger audit_rar_agentes_after_delete
  after delete on public.rar_agentes
  for each row execute function public.audit_rar_agentes();

-- -----------------------------------------------------------------------------
-- D.2 audit_puesto_agentes (junction: solo INSERT / DELETE, como
-- empleados_puestos — el PK no se updatea, se borra y reinserta)
-- -----------------------------------------------------------------------------

create or replace function public.audit_puesto_agentes()
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
      (new.consultora_id, auth.uid(), 'created', 'puesto_agentes', new.puesto_id,
       null,
       jsonb_build_object('puesto_id', new.puesto_id, 'agente_id', new.agente_id));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'puesto_agentes', old.puesto_id,
       jsonb_build_object('puesto_id', old.puesto_id, 'agente_id', old.agente_id),
       null);
    return old;
  end if;
  -- UPDATE deliberadamente no auditado (es junction PK, no se updatea).
  return null;
end;
$$;

create trigger audit_puesto_agentes_after_insert
  after insert on public.puesto_agentes
  for each row execute function public.audit_puesto_agentes();
create trigger audit_puesto_agentes_after_delete
  after delete on public.puesto_agentes
  for each row execute function public.audit_puesto_agentes();

-- =============================================================================
-- E. RLS (helpers T-015: is_member_of_consultora)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- E.1 rar_agentes (catálogo: any member SELECT/INSERT/UPDATE; NO DELETE)
-- -----------------------------------------------------------------------------

alter table public.rar_agentes enable row level security;

create policy rar_agentes_select_own on public.rar_agentes
  for select using (public.is_member_of_consultora(consultora_id));

create policy rar_agentes_insert_own on public.rar_agentes
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and created_by = auth.uid()
  );

create policy rar_agentes_update_own on public.rar_agentes
  for update
  using (public.is_member_of_consultora(consultora_id))
  with check (public.is_member_of_consultora(consultora_id));

-- DELETE: SIN policy. Soft-delete via archived_at.

-- -----------------------------------------------------------------------------
-- E.2 puesto_agentes (M:N: any member SELECT/INSERT/DELETE; NO UPDATE)
-- -----------------------------------------------------------------------------

alter table public.puesto_agentes enable row level security;

create policy puesto_agentes_select_own on public.puesto_agentes
  for select using (public.is_member_of_consultora(consultora_id));

create policy puesto_agentes_insert_own on public.puesto_agentes
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and (asignado_por is null or asignado_por = auth.uid())
  );

create policy puesto_agentes_delete_own on public.puesto_agentes
  for delete using (public.is_member_of_consultora(consultora_id));

-- UPDATE: SIN policy. Las asignaciones se borran/reinsertan (como empleados_puestos).
