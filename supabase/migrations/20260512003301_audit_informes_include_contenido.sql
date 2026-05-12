-- T-020 · Extender audit_informes() para capturar cambios de `contenido`.
--
-- Cambios sobre la version de T-019 (20260511232802_informes.sql):
-- 1. Diff guard `is distinct from` ahora incluye `contenido` ademas de
--    (titulo, tipo, status).
-- 2. before_data y after_data ahora incluyen:
--    - `contenido_preview` (primeros 500 chars + '...' si trunca, o NULL si
--       contenido es NULL).
--    - `contenido_size` (length real en chars, 0 si es NULL).
--
-- Razon de truncar a 500 chars: el contenido puede ser markdown de varios
-- KB (informes tecnicos completos). Sin truncar, audit_log infla rapido y
-- los logs visuales se vuelven inusables. 500 chars cubren el primer parrafo
-- — suficiente para entender el cambio en una auditoria. El size completo
-- queda en `contenido_size` para queries como "informes con contenido > X"
-- sin tocar el campo `contenido` directamente.
--
-- Patron forward: tablas futuras con campos de texto largo (notas de
-- clientes, descripciones de hallazgos en checklists, etc.) deben copiar
-- este patron truncado en sus triggers de audit.
--
-- Los 3 triggers existentes (audit_informes_after_{insert,update,delete})
-- siguen apuntando a esta funcion — no hay que recrearlos. `create or
-- replace` basta para el rollout.

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
         'contenido_size', coalesce(length(new.contenido), 0),
         'contenido_preview', case
           when new.contenido is null then null
           when length(new.contenido) <= 500 then new.contenido
           else substring(new.contenido for 500) || '...'
         end
       ));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.titulo, new.tipo, new.status, new.contenido) is distinct from
       (old.titulo, old.tipo, old.status, old.contenido) then
      v_before_payload := jsonb_build_object(
        'titulo', old.titulo,
        'tipo', old.tipo,
        'status', old.status,
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
  'T-020: trigger AFTER que escribe a audit_log en INSERT/UPDATE/DELETE de informes. Incluye contenido (preview 500 chars + size). Patron forward para tablas con texto largo.';
