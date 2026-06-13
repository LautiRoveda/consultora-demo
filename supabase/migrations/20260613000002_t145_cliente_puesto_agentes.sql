-- T-145 · RAR — Exposición POR ESTABLECIMIENTO (refactor pre-Fase 3).
--
-- El RAR es una DJ por establecimiento. La Fase 1 (T-143) modeló la exposición a
-- nivel puesto-global (`puesto_agentes`: el mismo "Soldador" expone igual en
-- todos los clientes). En HyS la exposición varía por establecimiento (un
-- "Operario" expone según qué se produce) → el modelo puesto-global forzaba a
-- duplicar puestos o a declarar exposición incorrecta en un documento legal.
-- Lo corregimos ahora que el feature es nuevo y SIN DATOS en prod (puesto_agentes
-- = 0 filas), antes de que la Fase 3 (snapshot + vencimiento) lo cemente.
--
-- Decisión (ADR-0016, decisión B revisada en T-145):
-- - La exposición pasa de `puesto_agentes (puesto×agente)` a
--   `cliente_puesto_agentes (cliente×puesto×agente)`.
-- - El puesto SIGUE siendo catálogo global reusable: NO se tocan `puestos` ni
--   `empleados_puestos` (los comparten empleados y EPP). Lo que se vuelve
--   contextual al establecimiento es la asignación de agentes.
-- - El empleado hereda la exposición de SU cliente × SUS puestos.
-- - Tres FK COMPUESTAS Ring A (ADR-0015 / T-121): coherencia consultora_id
--   estructural entre la junction y los TRES parents (clientes/puestos/
--   rar_agentes), todos con unique(id, consultora_id) ya existente.
--
-- RLS: helpers T-015 (is_member_of_consultora). Junction → any member
-- SELECT/INSERT/DELETE; NO UPDATE (se borra/reinserta, molde puesto_agentes).
--
-- DROP de `puesto_agentes` (+ su función audit + triggers) al final: tabla vacía
-- en prod (verificado), drop limpio sin migración de datos. El audit_log
-- histórico de puesto_agentes queda (entity_type viejo, inmutable). El único
-- consumidor de la tabla vieja es su propia función audit, que se dropea acá; no
-- hay triggers plpgsql externos que referencien sus columnas.

-- =============================================================================
-- A. TABLA cliente_puesto_agentes (junction 3-way, FK COMPUESTAS Ring A)
-- =============================================================================

-- consultora_id denormalizado para RLS fast-path sin join a los parents (mismo
-- trade-off que puesto_agentes / empleados_puestos). Las 3 FK compuestas
-- garantizan que cliente, puesto Y agente pertenecen a la MISMA consultora que la
-- fila junction (coherencia estructural Ring A, ADR-0015).
create table public.cliente_puesto_agentes (
  cliente_id    uuid not null,
  puesto_id     uuid not null,
  agente_id     uuid not null,
  consultora_id uuid not null references public.consultoras(id) on delete cascade,
  asignado_at   timestamptz not null default now(),
  asignado_por  uuid references auth.users(id) on delete set null,
  primary key (cliente_id, puesto_id, agente_id),
  constraint cpa_cliente_consultora_fkey
    foreign key (cliente_id, consultora_id)
    references public.clientes(id, consultora_id) on delete cascade,
  constraint cpa_puesto_consultora_fkey
    foreign key (puesto_id, consultora_id)
    references public.puestos(id, consultora_id) on delete cascade,
  constraint cpa_agente_consultora_fkey
    foreign key (agente_id, consultora_id)
    references public.rar_agentes(id, consultora_id) on delete cascade
);

comment on table public.cliente_puesto_agentes is
  'T-145: junction 3-way cliente×puesto×agente de riesgo (exposición POR '
  'ESTABLECIMIENTO). Reemplaza puesto_agentes (T-143, exposición puesto-global). '
  'El empleado hereda la unión de agentes de su cliente × sus puestos. FK '
  'compuestas Ring A: cliente, puesto y agente deben ser de la misma consultora '
  'que la fila. consultora_id denormalizado para RLS fast-path.';

create index idx_cpa_cliente_puesto
  on public.cliente_puesto_agentes(cliente_id, puesto_id);

create index idx_cpa_agente
  on public.cliente_puesto_agentes(agente_id);

create index idx_cpa_consultora
  on public.cliente_puesto_agentes(consultora_id);

-- =============================================================================
-- B. AUDIT TRIGGER (junction: solo INSERT / DELETE, molde audit_puesto_agentes)
-- =============================================================================

-- entity_id = cliente_id (el establecimiento es la entidad de negocio del RAR);
-- payload con los tres ids. UPDATE no auditado (junction PK, se borra/reinserta).
create or replace function public.audit_cliente_puesto_agentes()
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
      (new.consultora_id, auth.uid(), 'created', 'cliente_puesto_agentes', new.cliente_id,
       null,
       jsonb_build_object('cliente_id', new.cliente_id, 'puesto_id', new.puesto_id,
                          'agente_id', new.agente_id));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'cliente_puesto_agentes', old.cliente_id,
       jsonb_build_object('cliente_id', old.cliente_id, 'puesto_id', old.puesto_id,
                          'agente_id', old.agente_id),
       null);
    return old;
  end if;
  -- UPDATE deliberadamente no auditado (es junction PK, no se updatea).
  return null;
end;
$$;

create trigger audit_cliente_puesto_agentes_after_insert
  after insert on public.cliente_puesto_agentes
  for each row execute function public.audit_cliente_puesto_agentes();
create trigger audit_cliente_puesto_agentes_after_delete
  after delete on public.cliente_puesto_agentes
  for each row execute function public.audit_cliente_puesto_agentes();

-- =============================================================================
-- C. RLS (helpers T-015: is_member_of_consultora)
-- =============================================================================

-- M:N: any member SELECT/INSERT/DELETE; NO UPDATE (se borra/reinserta).
alter table public.cliente_puesto_agentes enable row level security;

create policy cliente_puesto_agentes_select_own on public.cliente_puesto_agentes
  for select using (public.is_member_of_consultora(consultora_id));

create policy cliente_puesto_agentes_insert_own on public.cliente_puesto_agentes
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and (asignado_por is null or asignado_por = auth.uid())
  );

create policy cliente_puesto_agentes_delete_own on public.cliente_puesto_agentes
  for delete using (public.is_member_of_consultora(consultora_id));

-- UPDATE: SIN policy. Las asignaciones se borran/reinsertan (como empleados_puestos).

-- =============================================================================
-- D. DROP del modelo viejo puesto_agentes (tabla vacía en prod, drop limpio)
-- =============================================================================

drop trigger if exists audit_puesto_agentes_after_insert on public.puesto_agentes;
drop trigger if exists audit_puesto_agentes_after_delete on public.puesto_agentes;
drop table if exists public.puesto_agentes;
drop function if exists public.audit_puesto_agentes();
