-- T-005 · Extensiones requeridas por el modelo de datos.
-- Referencia: docs/technical/03-data-model.md (sección "Extensiones requeridas").
-- Esta es la primera migration aplicada al remote para validar el pipeline.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";
create extension if not exists "pg_cron";
