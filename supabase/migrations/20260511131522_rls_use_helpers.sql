-- T-015 · Refactor de policies existentes para usar los helpers de la migration
-- 20260511130757_rls_helpers.sql.
--
-- Objetivo: reemplazar subqueries inline `exists (select 1 from consultora_members ...)`
-- por invocaciones a los helpers (`public.is_member_of_consultora(X)` /
-- `public.is_owner_of_consultora(X)`). Comportamiento de las policies queda
-- SEMANTICAMENTE IDENTICO — solo legibilidad y reuso.
--
-- Mapeo:
--   1. T-011 `consultoras_update_own_owner` (subquery exists con role='owner')
--      → `id = current_consultora_id() and public.is_owner_of_consultora(id)`
--   2. T-013 `consultoras_select_own_member` (subquery exists sin role)
--      → `public.is_member_of_consultora(id)`
--
-- Policies que NO se tocan (no usan subquery a consultora_members):
--   - `consultoras_select_own` — `id = current_consultora_id()` (T-011)
--   - `consultora_members_select_own` — `consultora_id = current_consultora_id()` (T-011)
--   - `consultora_members_select_self` — `user_id = auth.uid()` (T-011)
--   - `audit_log_select_own` — `consultora_id = current_consultora_id()` (T-011)
--
-- Las tablas del dominio de T-019+ van a estrenar los helpers desde el dia 1.

-- =============================================================================
-- 1. consultoras_update_own_owner (T-011)
-- =============================================================================
drop policy if exists consultoras_update_own_owner on public.consultoras;

create policy consultoras_update_own_owner on public.consultoras
  for update using (
    id = public.current_consultora_id()
    and public.is_owner_of_consultora(id)
  );

comment on policy consultoras_update_own_owner on public.consultoras is
  'T-011 (refactor T-015): UPDATE solo si es la consultora del JWT claim Y el user es owner. Usa is_owner_of_consultora.';


-- =============================================================================
-- 2. consultoras_select_own_member (T-013)
-- =============================================================================
drop policy if exists consultoras_select_own_member on public.consultoras;

create policy consultoras_select_own_member on public.consultoras
  for select using (
    public.is_member_of_consultora(id)
  );

comment on policy consultoras_select_own_member on public.consultoras is
  'T-013 (refactor T-015): SELECT defensivo pre-T-016 — permite leer la propia consultora via membership sin depender del custom claim. Usa is_member_of_consultora.';
