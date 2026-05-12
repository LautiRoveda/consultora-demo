-- T-021 · Metadata estructurada por informe (form-driven templates).
--
-- Primer ticket del patron "template parametrizado por tipo". RGRL es el
-- caso piloto; T-022 va a sumar capacitacion/relevamiento/accidente/otros
-- al mismo schema (data jsonb, sin schema enforcement DB-side — la
-- validacion vive en src/shared/templates/<tipo>/schema.ts por tipo).
--
-- Relacion con `public.informes`: 1:1 via PK=FK. on delete cascade: la
-- metadata muere con su informe (no hay valor en preservarla huerfana).
--
-- RLS: en lugar de denormalizar consultora_id en la tabla, las policies
-- hacen EXISTS-subquery contra informes y aplican los helpers de T-015.
-- Justificacion: la PK=informe_id ya es lookup B-tree O(log n), el plan
-- es scan+EXISTS de 1 row, no agrega costo material para los accesos
-- T-021 (todos por informe_id directo, no listings cross-informe).
--
-- Audit trigger: mismo patron forward que T-019/T-020. Copia jsonb full
-- en before/after cuando pg_column_size(data) <= 4 KB (guard defensivo
-- vs ~2-3 KB de payload realista); fallback _truncated sin field_count
-- innecesario cuando esta dentro del umbral. consultora_id sale de un
-- subquery una sola vez por trigger fire.


-- =============================================================================
-- TABLA
-- =============================================================================

create table public.informe_metadata (
  informe_id  uuid primary key
              references public.informes(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.informe_metadata is
  'T-021: form-driven metadata por informe. data es jsonb sin schema enforcement DB-side; la validacion vive en src/shared/templates/<tipo>/schema.ts. 1:1 con informes via PK=FK.';
comment on column public.informe_metadata.data is
  'Payload jsonb del form estructurado del tipo de informe. Shape gobernado por el schema TS del tipo (rgrlMetadataSchema en T-021).';


-- =============================================================================
-- TRIGGER DE METADATA
-- =============================================================================
-- Reusa la funcion compartida public.set_updated_at() definida en
-- tenancy.sql (T-011). No re-declarada aqui.

create trigger set_updated_at_informe_metadata
  before update on public.informe_metadata
  for each row execute function public.set_updated_at();


-- =============================================================================
-- AUDIT TRIGGER
-- =============================================================================
-- Patron forward heredado de T-019/T-020:
-- - security definer + search_path = '': bypasea default-deny de audit_log.
-- - auth.uid() captura el actor (NULL si la mutation viene sin JWT context).
-- - Diff guard `is distinct from` sobre data: cero rows de audit cuando el
--   UPDATE solo toca updated_at (trigger metadata corre antes que este AFTER,
--   asi que `old.data is distinct from new.data` es el test correcto).
-- - Payload jsonb:
--     'data_size_bytes': size real (pg_column_size del jsonb).
--     'data': payload completo cuando <= 4096 bytes; { _truncated: true } si excede.
-- - consultora_id se obtiene del informe parent (no esta en metadata).
--   Subquery una sola vez al inicio del trigger. Si el informe ya fue
--   borrado (cascade en curso) abortamos sin auditar — el DELETE del
--   informe parent ya cubrio la operacion en su propio audit row.

create or replace function public.audit_informe_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consultora_id  uuid;
  v_before_payload jsonb;
  v_after_payload  jsonb;
begin
  if tg_op in ('INSERT','UPDATE') then
    select i.consultora_id into v_consultora_id
      from public.informes i where i.id = new.informe_id;
  else
    select i.consultora_id into v_consultora_id
      from public.informes i where i.id = old.informe_id;
  end if;

  -- Cascade desde informes: el informe parent ya fue borrado, abortamos sin auditar.
  if v_consultora_id is null then return coalesce(new, old); end if;

  if tg_op = 'INSERT' then
    v_after_payload := jsonb_build_object(
      'data_size_bytes', coalesce(pg_column_size(new.data), 0),
      'data', case
        when pg_column_size(new.data) <= 4096 then new.data
        else jsonb_build_object('_truncated', true)
      end
    );
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (v_consultora_id, auth.uid(), 'created', 'informe_metadata', new.informe_id,
       null, v_after_payload);
    return new;

  elsif tg_op = 'UPDATE' then
    if new.data is distinct from old.data then
      v_before_payload := jsonb_build_object(
        'data_size_bytes', coalesce(pg_column_size(old.data), 0),
        'data', case
          when pg_column_size(old.data) <= 4096 then old.data
          else jsonb_build_object('_truncated', true)
        end
      );
      v_after_payload := jsonb_build_object(
        'data_size_bytes', coalesce(pg_column_size(new.data), 0),
        'data', case
          when pg_column_size(new.data) <= 4096 then new.data
          else jsonb_build_object('_truncated', true)
        end
      );
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (v_consultora_id, auth.uid(), 'updated', 'informe_metadata', new.informe_id,
         v_before_payload, v_after_payload);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    -- Solo cubre DELETE directo (sin cascade). UI no expone DELETE — la fila
    -- vive y muere con su informe parent. Util para jobs admin via service-role.
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (v_consultora_id, auth.uid(), 'deleted', 'informe_metadata', old.informe_id,
       jsonb_build_object('data_size_bytes', coalesce(pg_column_size(old.data), 0)),
       null);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_informe_metadata() is
  'T-021: trigger AFTER que escribe a audit_log en INSERT/UPDATE/DELETE de informe_metadata. consultora_id desde informe parent. Payload jsonb full <= 4 KB, fallback {_truncated:true} si excede.';

create trigger audit_informe_metadata_after_insert
  after insert on public.informe_metadata
  for each row execute function public.audit_informe_metadata();

create trigger audit_informe_metadata_after_update
  after update on public.informe_metadata
  for each row execute function public.audit_informe_metadata();

create trigger audit_informe_metadata_after_delete
  after delete on public.informe_metadata
  for each row execute function public.audit_informe_metadata();


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.informe_metadata enable row level security;

-- SELECT: member de la consultora del informe parent.
create policy informe_metadata_select_own on public.informe_metadata
  for select using (
    exists (
      select 1 from public.informes i
      where i.id = informe_metadata.informe_id
        and public.is_member_of_consultora(i.consultora_id)
    )
  );

-- INSERT: member de la consultora Y (creator del informe O owner consultora).
-- Mismo gate que `informes_update_own_or_owner` (T-019): solo quien puede
-- editar el informe puede crear/escribir su metadata.
create policy informe_metadata_insert_own on public.informe_metadata
  for insert with check (
    exists (
      select 1 from public.informes i
      where i.id = informe_metadata.informe_id
        and public.is_member_of_consultora(i.consultora_id)
        and (i.created_by = auth.uid() or public.is_owner_of_consultora(i.consultora_id))
    )
  );

-- UPDATE: idem INSERT, con USING + WITH CHECK.
create policy informe_metadata_update_own on public.informe_metadata
  for update
  using (
    exists (
      select 1 from public.informes i
      where i.id = informe_metadata.informe_id
        and public.is_member_of_consultora(i.consultora_id)
        and (i.created_by = auth.uid() or public.is_owner_of_consultora(i.consultora_id))
    )
  )
  with check (
    exists (
      select 1 from public.informes i
      where i.id = informe_metadata.informe_id
        and public.is_member_of_consultora(i.consultora_id)
        and (i.created_by = auth.uid() or public.is_owner_of_consultora(i.consultora_id))
    )
  );

-- DELETE: SIN policy. La fila vive y muere con su informe (ON DELETE CASCADE).
-- Hard-delete directo solo via service-role (admin jobs).

comment on policy informe_metadata_select_own on public.informe_metadata is
  'T-021: SELECT por membership de la consultora del informe parent. EXISTS-subquery con helper is_member_of_consultora.';
comment on policy informe_metadata_insert_own on public.informe_metadata is
  'T-021: INSERT por creator del informe O owner de la consultora. Mismo gate que informes UPDATE.';
comment on policy informe_metadata_update_own on public.informe_metadata is
  'T-021: UPDATE por creator del informe O owner. USING + WITH CHECK simetricos.';
