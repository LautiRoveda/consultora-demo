-- T-013 · Policy defensiva en consultoras para habilitar el dashboard pre-T-016.
--
-- Problema: la policy existente `consultoras_select_own` (T-011) requiere
-- `id = current_consultora_id()`, que devuelve NULL hasta que T-016 instale
-- el Auth Hook que inyecta `consultora_id` en `app_metadata` del JWT.
--
-- Consecuencia: un user logueado NO puede leer su propia consultora (ni
-- siquiera via JOIN desde consultora_members donde sí puede leer su membership
-- gracias a `consultora_members_select_self` de T-011).
--
-- Esta policy es el patrón espejo de `consultora_members_select_self`: permite
-- SELECT en consultoras si el user tiene membership en esa consultora,
-- evaluado por `auth.uid()` directamente (sin depender del custom claim).
--
-- PostgreSQL combina policies SELECT con OR. Cuando T-016 instale el claim:
-- - `consultoras_select_own` matchea (vía claim).
-- - `consultoras_select_own_member` también (vía JOIN).
-- - Resultado: redundancia inocua. T-016 puede mantener o remover.

create policy consultoras_select_own_member on public.consultoras
  for select using (
    exists (
      select 1 from public.consultora_members
      where consultora_members.consultora_id = consultoras.id
        and consultora_members.user_id = auth.uid()
    )
  );

comment on policy consultoras_select_own_member on public.consultoras is
  'T-013 defensiva pre-T-016: permite SELECT si el user es miembro, sin depender del custom claim del JWT.';
