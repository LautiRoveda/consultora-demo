-- T-142 · Columna de control del onboarding wizard.
-- NULL = wizard activo. NOT NULL = completado (timestamp del momento en que el
-- usuario eligió su primer camino desde el wizard del dashboard). No hay FK ni
-- RLS extra: es metadata operativa de la consultora y cae bajo la policy
-- existente de `consultoras` (SELECT/UPDATE own-owner via helpers T-015).
ALTER TABLE consultoras
  ADD COLUMN IF NOT EXISTS onboarding_completado_at TIMESTAMPTZ;
