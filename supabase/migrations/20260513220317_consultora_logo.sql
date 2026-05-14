-- T-024 · Logo de consultora.
--
-- Suma columna `logo_storage_path` a `consultoras`. Nullable: la mayoria
-- de consultoras va a arrancar sin logo (fallback al wordmark texto con
-- consultora.name en el header del PDF).
--
-- Path scheme: <consultora_id>/logo-<timestamp>.<ext> dentro del bucket
-- `consultora-logos`. Solo 1 logo activo por consultora: al subir uno
-- nuevo, el server action borra el anterior del bucket antes de update.
--
-- No hay audit trigger dedicado para esta columna en T-024 (cambio de
-- logo es de baja frecuencia y se loggea en pino + sentry desde el server
-- action). Si en el futuro se quiere historial de logos, sumar tabla
-- `consultora_logo_history` (out-of-scope T-024).

alter table public.consultoras
  add column logo_storage_path text;

comment on column public.consultoras.logo_storage_path is
  'T-024: path dentro del bucket consultora-logos. Null = no logo (fallback a wordmark con consultora.name).';
