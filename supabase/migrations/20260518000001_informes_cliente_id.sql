-- T-050 · Integración Clientes ↔ Informes.
--
-- Suma FK opcional `informes.cliente_id` que liga el informe a un cliente del
-- mismo tenant (ya creado via T-047/T-048/T-049). El consultor selecciona
-- cliente al crear informe (T-050 UI wizard step 2) y los 5 fields de
-- identificación (razon_social/cuit/domicilio/localidad/provincia) se
-- autopopulan en lugar de pedirle escribirlos cada vez.
--
-- Decisiones:
--
-- 1. FK nullable + ON DELETE SET NULL: el informe es legalmente firmado por el
--    matriculado y NO puede borrarse aunque desaparezca el cliente.
--    `set null` preserva el informe perdiendo solo el link.
--
-- 2. Informes pre-T-050 quedan con cliente_id IS NULL (legacy, no backfill).
--    Informes tipo "otros" pueden quedar sin cliente vinculado (UX OK).
--
-- 3. El FK valida que la row exista pero NO respeta RLS — un atacante con
--    cookie válido podría pasar un cliente_id de OTRO tenant y el INSERT
--    pasaría. Defensa: `createInformeAction` hace SELECT RLS-aware ANTES del
--    INSERT (ver src/app/(app)/informes/actions.ts).
--
-- 4. Audit trigger `audit_informes()` (T-019, ya extendido en T-020) se
--    extiende ahora con `cliente_id` tanto en el diff guard como en los
--    payloads INSERT/UPDATE/DELETE. Forward-compat para T-051 (reasignar
--    cliente) — cambios de vinculación son business-relevant.
--
-- 5. Los 3 triggers existentes (audit_informes_after_{insert,update,delete})
--    siguen apuntando a la misma función. `create or replace function` basta.

-- =========================================================================
-- 1. Columna FK + comment
-- =========================================================================

alter table public.informes
  add column cliente_id uuid references public.clientes(id) on delete set null;

comment on column public.informes.cliente_id is
  'T-050: FK opcional a clientes.id. Nullable porque (a) informes pre-T-050 quedan '
  'huérfanos por backfill no requerido, (b) tipo "otros" puede no llevar referencia. '
  'ON DELETE SET NULL: archivar/borrar cliente preserva el informe (legalmente firmado '
  'por matriculado — no puede borrarse) perdiendo solo el link. El FK valida existencia '
  'pero NO respeta RLS — createInformeAction hace SELECT defensive RLS-aware antes del '
  'INSERT para prevenir cross-tenant link.';

-- =========================================================================
-- 2. Index parcial (reverse lookup: detail view del cliente → informes)
-- =========================================================================

create index idx_informes_cliente_id
  on public.informes(cliente_id, created_at desc)
  where cliente_id is not null;

-- =========================================================================
-- 3. Extender audit_informes() con cliente_id (diff guard + payloads)
-- =========================================================================

create or replace function public.audit_informes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_payload jsonb;
  v_after_payload  jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (new.consultora_id, auth.uid(), 'created', 'informes', new.id,
       null,
       jsonb_build_object(
         'tipo', new.tipo,
         'titulo', new.titulo,
         'status', new.status,
         'cliente_id', new.cliente_id,
         'contenido_size', coalesce(length(new.contenido), 0),
         'contenido_preview', case
           when new.contenido is null then null
           when length(new.contenido) <= 500 then new.contenido
           else substring(new.contenido for 500) || '...'
         end
       ));
    return new;
  elsif tg_op = 'UPDATE' then
    -- Diff guard extendido con cliente_id (forward-compat T-051 reasignar cliente).
    if (new.titulo, new.tipo, new.status, new.contenido, new.cliente_id) is distinct from
       (old.titulo, old.tipo, old.status, old.contenido, old.cliente_id) then
      v_before_payload := jsonb_build_object(
        'titulo', old.titulo,
        'tipo', old.tipo,
        'status', old.status,
        'cliente_id', old.cliente_id,
        'contenido_size', coalesce(length(old.contenido), 0),
        'contenido_preview', case
          when old.contenido is null then null
          when length(old.contenido) <= 500 then old.contenido
          else substring(old.contenido for 500) || '...'
        end
      );
      v_after_payload := jsonb_build_object(
        'titulo', new.titulo,
        'tipo', new.tipo,
        'status', new.status,
        'cliente_id', new.cliente_id,
        'contenido_size', coalesce(length(new.contenido), 0),
        'contenido_preview', case
          when new.contenido is null then null
          when length(new.contenido) <= 500 then new.contenido
          else substring(new.contenido for 500) || '...'
        end
      );
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'informes', new.id,
         v_before_payload, v_after_payload);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'informes', old.id,
       jsonb_build_object(
         'titulo', old.titulo,
         'tipo', old.tipo,
         'status', old.status,
         'cliente_id', old.cliente_id,
         'contenido_size', coalesce(length(old.contenido), 0),
         'contenido_preview', case
           when old.contenido is null then null
           when length(old.contenido) <= 500 then old.contenido
           else substring(old.contenido for 500) || '...'
         end
       ),
       null);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_informes() is
  'T-020 + T-050: trigger AFTER que escribe a audit_log en INSERT/UPDATE/DELETE de informes. '
  'Incluye cliente_id en diff guard + payloads (T-050). Patrón forward para tablas con FKs '
  'business-relevant.';
