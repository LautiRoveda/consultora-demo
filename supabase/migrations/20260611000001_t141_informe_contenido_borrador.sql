-- T-141 Fase C · Autosave de borrador.
--
-- Columna scratch separada del contenido canónico auditado. El autosave (debounce
-- ~2-3s) escribe acá, NO en `contenido`, para no inflar el audit_log: el trigger
-- `audit_informes()` solo audita cuando cambia su diff guard
-- (titulo, tipo, status, contenido, cliente_id) — `contenido_borrador` queda fuera,
-- así que un UPDATE de solo borrador es invisible al audit. Confirmado contra el
-- trigger vigente.
--
-- Ciclo de vida:
--  - autosave         → set contenido_borrador (no auditado).
--  - "Guardar cambios"→ set contenido = borrador, contenido_borrador = null (auditado).
--  - publish          → promueve borrador → contenido + status=published (auditado).
--  - load             → el editor arranca con contenido_borrador ?? contenido.
--
-- NULL = sin cambios sin commitear. Aditiva, nullable, sin default → cero impacto
-- en filas existentes y en el trigger (no hay que recrearlo).

alter table public.informes add column contenido_borrador text;

comment on column public.informes.contenido_borrador is
  'T-141: borrador de autosave (scratch). NULL = sin cambios sin commitear. Fuera del diff guard de audit_informes() → no auditado. Se promueve a contenido en guardado manual/publish.';
