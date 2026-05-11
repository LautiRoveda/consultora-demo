-- T-016 PARADA #3 · Fast-path en RLS helpers via claim del JWT.
--
-- Post-T-016 el JWT trae app_metadata.consultora_id + consultora_role inyectados
-- por el hook (PARADA #1 + #2). Refactoreamos los 4 helpers de T-015 para que
-- primero intenten resolver via claim (in-memory, cero IO) y solo si el claim
-- esta ausente caigan al lookup en consultora_members. Resultado esperado: ~99%
-- de requests con sesion fresh resuelven sin tocar la tabla.
--
-- Patron por helper: `(claim_check) OR exists (membership_check)`.
-- - Si el claim matchea, OR cortocircuita y skipea la subquery.
-- - Si el claim no matchea (m2m con otra consultora) o es NULL, cae al exists
--   que es el comportamiento legacy de T-015.
--
-- TRADE-OFF DOCUMENTADO (revocation latency):
-- - Si un user es REMOVIDO de consultora_members (DELETE), su JWT viejo todavia
--   lleva el claim consultora_id por hasta 1h (jwt_expiry default). Durante
--   esa ventana, el fast-path retorna `true` aunque la membership ya no exista.
-- - Old behavior (sin fast-path): retornaba `false` inmediato (consulta la tabla).
-- - Es el trade-off estandar de JWT-based auth — `current_consultora_id()` ya
--   tiene esta propiedad post-T-016. Esta migration la extiende a los helpers.
-- - Mitigaciones: (a) refresh explicito en flows criticos (login + callback,
--   ver actions/route de PARADA #3); (b) cuando llegue T-???? con flow real
--   de "expulsar miembro", emitir admin.auth.admin.signOut(userId) para
--   invalidar todos los refresh tokens y forzar re-login.
-- - Hoy MVP no expone "expulsar miembro", entonces la ventana es inalcanzable
--   en la practica.
--
-- Tests RLS de T-015 (rls.test.ts, 18 cases): siguen verdes porque las
-- assertions actuales no simulan revocacion mid-session. Si en el futuro se
-- agregan tests de revocation, esperar `true` durante la ventana de 1h.
--
-- Convenciones (heredadas de T-015): language sql, stable, security definer,
-- search_path = ''. Grants no se tocan (ya fueron alineados en T-015).


-- =============================================================================
-- is_member_of_consultora — fast-path via claim
-- =============================================================================

create or replace function public.is_member_of_consultora(p_consultora_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'consultora_id')::uuid = p_consultora_id,
      false
    )
    or exists (
      select 1 from public.consultora_members
      where user_id = auth.uid()
        and consultora_id = p_consultora_id
    )
$$;


-- =============================================================================
-- is_owner_of_consultora — fast-path via claim (consultora_id + role)
-- =============================================================================
-- Claim corto-circuita solo si AMBOS coinciden (consultora_id matches y role
-- es 'owner'). Si solo matchea uno (caso m2m hipotetico: claim de cA pero
-- pregunta por cB siendo owner de cB), cae al exists.

create or replace function public.is_owner_of_consultora(p_consultora_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'consultora_id')::uuid = p_consultora_id
        and (auth.jwt() -> 'app_metadata' ->> 'consultora_role') = 'owner',
      false
    )
    or exists (
      select 1 from public.consultora_members
      where user_id = auth.uid()
        and consultora_id = p_consultora_id
        and role = 'owner'
    )
$$;


-- =============================================================================
-- role_on_consultora — fast-path via claim (devuelve el role si claim matchea)
-- =============================================================================
-- Diferencia con los booleanos: aca el claim NO puede corto-circuitar con OR
-- porque devolvemos text, no boolean. Patron: COALESCE(claim_role, db_role).
-- Si el claim matchea consultora_id, usamos el role del claim. Si no matchea
-- o esta ausente, fallback al lookup en consultora_members.

create or replace function public.role_on_consultora(p_consultora_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when (auth.jwt() -> 'app_metadata' ->> 'consultora_id')::uuid = p_consultora_id
        then auth.jwt() -> 'app_metadata' ->> 'consultora_role'
      else null
    end,
    (
      select role from public.consultora_members
      where user_id = auth.uid()
        and consultora_id = p_consultora_id
      limit 1
    )
  )
$$;


-- =============================================================================
-- my_consultora_ids — fast-path via claim (1 row si presente)
-- =============================================================================
-- MVP single-tenant per user: el claim contiene 0 o 1 consultora_id. Si esta
-- presente, devolvemos esa fila sin tocar consultora_members. Si esta ausente,
-- fallback al SELECT en consultora_members (legacy T-015).
--
-- IMPORTANTE para m2m futuro: cuando lleguemos a multi-tenant per user, el
-- claim seguira teniendo solo el tenant ACTIVO de la sesion. Esta function
-- en su forma fast-path devolveria UN row del claim. Si el caller necesita
-- TODAS las consultoras del user, el fallback se gatilla solo si el claim
-- esta ausente — lo cual NO va a ser el caso m2m. Para m2m hay que decidir
-- otra estrategia (ej: helper my_all_consultora_ids() que SIEMPRE consulte
-- la tabla). Out of scope T-016.

create or replace function public.my_consultora_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Patron UNION ALL con guards mutuamente excluyentes:
  -- - branch 1 corre solo si claim presente (1 row, sin tocar consultora_members).
  -- - branch 2 corre solo si claim ausente (0+ rows desde la tabla).
  -- El planner inlinea ambos guards; en cada request solo una rama ejecuta.
  select (auth.jwt() -> 'app_metadata' ->> 'consultora_id')::uuid
  where (auth.jwt() -> 'app_metadata' ->> 'consultora_id') is not null
  union all
  select consultora_id from public.consultora_members
  where user_id = auth.uid()
    and (auth.jwt() -> 'app_metadata' ->> 'consultora_id') is null
$$;


-- =============================================================================
-- COMMENTS (actualizados)
-- =============================================================================

comment on function public.is_member_of_consultora(uuid) is
  'T-015 + T-016 fast-path: claim primero, fallback a consultora_members. Trade-off documentado: revocation latency = JWT expiry (1h).';
comment on function public.is_owner_of_consultora(uuid) is
  'T-015 + T-016 fast-path: claim role=owner primero, fallback a consultora_members. Trade-off: revocation latency = JWT expiry.';
comment on function public.role_on_consultora(uuid) is
  'T-015 + T-016 fast-path: claim_role si matchea consultora_id, fallback al lookup en consultora_members.';
comment on function public.my_consultora_ids() is
  'T-015 + T-016 fast-path: claim devuelve 1 row si presente (MVP single-tenant). m2m futuro requiere helper distinto.';


-- Grants: ya fueron alineados por T-015 (revoke public/anon, grant authenticated/service_role).
-- create or replace function preserva los grants existentes, no hace falta re-aplicarlos.
