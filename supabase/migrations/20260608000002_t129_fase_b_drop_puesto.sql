-- T-129 (fase B) · Drop de la columna legacy empleados.puesto + de la funcion
-- de backfill transitoria. Fase A corto todos los READERS; el puente que ESCRIBIA
-- la columna (empleados/actions.ts) se elimina en este mismo PR.
--
-- CRITICO: audit_empleados() referencia new/old.puesto en 5 lugares. Postgres NO
-- trackea cuerpos plpgsql como dependencias de columna, asi que el DROP COLUMN
-- tendria exito pero el trigger tiraria 'record "new" has no field "puesto"' en el
-- proximo INSERT/UPDATE. Recreamos la funcion SIN puesto ANTES del drop, misma tx.

-- 1) Recrear audit_empleados() sin las 5 refs a puesto. Guard 11->10 fields;
--    after_data INSERT 7->6 keys; payloads UPDATE 11->10. DELETE no usa puesto:
--    queda igual. Los 3 triggers siguen ligados al mismo OID (no se recrean).
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
         'fecha_ingreso', new.fecha_ingreso
       ));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.cliente_id, new.nombre, new.apellido, new.dni, new.cuil,
        new.email, new.telefono, new.fecha_ingreso,
        new.fecha_nacimiento, new.archived_at)
       is distinct from
       (old.cliente_id, old.nombre, old.apellido, old.dni, old.cuil,
        old.email, old.telefono, old.fecha_ingreso,
        old.fecha_nacimiento, old.archived_at) then
      v_before_payload := jsonb_build_object(
        'cliente_id', old.cliente_id,
        'nombre', old.nombre,
        'apellido', old.apellido,
        'dni', old.dni,
        'cuil', old.cuil,
        'email', old.email,
        'telefono', old.telefono,
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
  'T-052: trigger AFTER que escribe a audit_log en INSERT/UPDATE/DELETE de '
  'empleados. Diff guard sobre 10 fields mutables (notas excluido por tamano, '
  'patron T-047 notas). Snapshot before/after completo de los 10 fields del '
  'guard. T-129 fase B: puesto removido.';

-- 2) Drop de la columna legacy (su CHECK inline se va con ella; no hay indices,
--    FKs, policies ni generated columns sobre puesto).
alter table public.empleados drop column puesto;

-- 3) Drop de la funcion de backfill (identidad por tipo = (uuid); el grant/revoke
--    y el do-block one-shot de fase A no son dependencias almacenadas).
drop function public.backfill_empleados_puestos_from_legacy(uuid);
