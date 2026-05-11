-- T-015 · RLS helpers reusables para policies de tablas del dominio.
--
-- A partir de T-019+ vamos a tener 10+ tablas con policies similares a las de
-- T-011/T-013 (clientes, empleados, informes, EPP, notificaciones, ...). En
-- lugar de duplicar subqueries inline, factorizamos el patron en 4 helpers
-- que las policies van a invocar:
--
--   create policy ... using (public.is_member_of_consultora(consultora_id));
--   create policy ... using (public.is_owner_of_consultora(consultora_id));
--
-- Convenciones (alineadas con `current_consultora_id()` de T-011):
-- - `language sql`: maximiza inlining del planner cuando se invoca desde policy.
-- - `stable`: depende del JWT del request, no cambia durante la query.
-- - `security definer + search_path = ''`: patron Supabase canonico. Bypasa
--   RLS sin inyeccion de search_path. Nombres totalmente calificados con `public.`.
-- - `revoke from public, anon` + `grant execute to authenticated, service_role`:
--   anon nunca tiene `auth.uid()` valida, no tiene sentido permitirles invocar.
--
-- Performance:
-- - `unique (user_id, consultora_id)` en consultora_members (T-011) genera un
--   auto-index con columna lider `user_id`. Las 4 funciones lo usan:
--     * `is_member_of_consultora(X)` -> WHERE user_id = auth.uid() AND consultora_id = X
--     * `is_owner_of_consultora(X)`  -> idem + AND role = 'owner'
--     * `role_on_consultora(X)`      -> idem
--     * `my_consultora_ids()`        -> WHERE user_id = auth.uid()
-- - El planner inline las funciones simples (sql + stable) directamente en
--   la policy, asi que la performance es equivalente a la subquery escrita
--   a mano. No hay overhead de function call.
--
-- NO refactoreamos las policies existentes de T-011/T-013 todavia — eso lo
-- hace PARADA #2 de T-015 con tests de no-regresion.
--
-- Relacion con `current_consultora_id()` (T-011):
-- - `current_consultora_id()` extrae el tenant id del CUSTOM CLAIM del JWT
--   (`app_metadata.consultora_id`, inyectado por T-016 Auth Hook futuro).
--   Returns NULL pre-T-016. Las policies basadas en este helper filtran "este
--   row pertenece a la consultora del JWT".
-- - Los helpers de T-015 (`is_member_of_consultora` etc.) usan `auth.uid()` +
--   query a `consultora_members`. NO dependen del claim. Funcionan desde el
--   primer signup, util pre-T-016 y como defensa post-T-016.
-- - Ambos enfoques conviven con OR en las policies actuales (ej:
--   `consultoras_select_own` via claim + `consultoras_select_own_member` via
--   helper). Post-T-016, mantener ambos da defense-in-depth: si el claim no
--   se inyecta correctamente por bug del hook, el helper sigue garantizando
--   isolation por membership.


-- =============================================================================
-- is_member_of_consultora(p_consultora_id uuid) -> boolean
-- =============================================================================
-- True si auth.uid() es member (cualquier rol) de la consultora indicada.
-- Reemplaza inlines tipo:
--   exists (select 1 from consultora_members
--           where consultora_id = X and user_id = auth.uid())

create or replace function public.is_member_of_consultora(p_consultora_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.consultora_members
    where user_id = auth.uid()
      and consultora_id = p_consultora_id
  )
$$;

comment on function public.is_member_of_consultora(uuid) is
  'T-015: true si auth.uid() es member de la consultora indicada. Para uso en RLS policies.';


-- =============================================================================
-- is_owner_of_consultora(p_consultora_id uuid) -> boolean
-- =============================================================================
-- True si auth.uid() es member con role = 'owner' de la consultora indicada.
-- Reemplaza inlines tipo:
--   exists (select 1 from consultora_members
--           where consultora_id = X and user_id = auth.uid() and role = 'owner')

create or replace function public.is_owner_of_consultora(p_consultora_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.consultora_members
    where user_id = auth.uid()
      and consultora_id = p_consultora_id
      and role = 'owner'
  )
$$;

comment on function public.is_owner_of_consultora(uuid) is
  'T-015: true si auth.uid() es owner de la consultora indicada. Para uso en RLS policies.';


-- =============================================================================
-- role_on_consultora(p_consultora_id uuid) -> text
-- =============================================================================
-- Devuelve el rol de auth.uid() en la consultora (o NULL si no es member).
-- Util para policies con multiples roles o checks condicionales.
--
-- `limit 1`: explicitar la intencion. El UNIQUE (user_id, consultora_id) ya
-- garantiza maximo 1 row, pero `limit 1` lo hace claro para el lector.

create or replace function public.role_on_consultora(p_consultora_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.consultora_members
  where user_id = auth.uid()
    and consultora_id = p_consultora_id
  limit 1
$$;

comment on function public.role_on_consultora(uuid) is
  'T-015: rol de auth.uid() en la consultora indicada (owner|member) o NULL si no es member.';


-- =============================================================================
-- my_consultora_ids() -> setof uuid
-- =============================================================================
-- Lista de consultora_ids donde auth.uid() es member. MVP single-tenant per
-- user devuelve 0 o 1 row, pero el schema soporta m2m (T-011) — esta funcion
-- esta preparada para multi-tenant per user cuando llegue.
--
-- Util para policies con `IN`:
--   `consultora_id IN (select * from public.my_consultora_ids())`.

create or replace function public.my_consultora_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select consultora_id from public.consultora_members
  where user_id = auth.uid()
$$;

comment on function public.my_consultora_ids() is
  'T-015: consultora_ids donde auth.uid() es member. MVP devuelve 0 o 1; el schema soporta m2m.';


-- =============================================================================
-- GRANTS
-- =============================================================================
-- Patron consistente con `create_consultora_and_owner` (T-012): solo
-- authenticated + service_role. anon NO porque no tiene `auth.uid()` valida.

revoke all on function public.is_member_of_consultora(uuid) from public, anon;
grant execute on function public.is_member_of_consultora(uuid) to authenticated, service_role;

revoke all on function public.is_owner_of_consultora(uuid) from public, anon;
grant execute on function public.is_owner_of_consultora(uuid) to authenticated, service_role;

revoke all on function public.role_on_consultora(uuid) from public, anon;
grant execute on function public.role_on_consultora(uuid) to authenticated, service_role;

revoke all on function public.my_consultora_ids() from public, anon;
grant execute on function public.my_consultora_ids() to authenticated, service_role;
