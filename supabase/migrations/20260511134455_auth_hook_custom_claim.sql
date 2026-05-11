-- T-016 PARADA #1 · Auth Hook custom_access_token_hook (function standalone).
--
-- Inyecta consultora_id + consultora_role en app_metadata del JWT en cada token
-- issue. Lee membership desde public.consultora_members. PARADA #1 solo CREA la
-- function; el enchufe en config.toml + flow real de login es PARADA #2.
--
-- Patron defensivo: NUNCA tirar. Si algo falla, devuelve event sin tocar +
-- raise warning. Razon: GoTrue fails-closed si el hook tira -> el user no puede
-- loguearse. Preferimos JWT sin claim (current_consultora_id() devuelve NULL,
-- policies dan 0 rows, defensa adicional via fallback membership-based T-013)
-- antes que romper login.
--
-- Ver tambien: ADR-0006 (multi-tenant RLS strategy) + T-011 current_consultora_id().


-- =============================================================================
-- FUNCION: custom_access_token_hook(event jsonb) -> jsonb
-- =============================================================================
--
-- - language plpgsql: el exception handler requiere plpgsql (no sql).
-- - stable: el lookup depende del DB state pero no muta. Permite plan caching.
-- - security definer + search_path = '': patron Supabase canonico. Bypasa RLS
--   sin riesgo de search-path injection. Todos los nombres calificados con `public.`.
-- - coalesce(event -> 'claims', '{}'::jsonb): defensive frente a event mal formado.
-- - jsonb_set crea app_metadata upfront si no existe: jsonb_set anidado falla
--   silenciosamente (devuelve target sin cambios) si un ancestor no existe.
-- - to_jsonb(uuid::text): jsonb representa UUIDs como string. Cast explicito
--   evita sorpresas en el shape del claim.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id        uuid;
  v_consultora_id  uuid;
  v_role           text;
  v_claims         jsonb;
begin
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims  := coalesce(event -> 'claims', '{}'::jsonb);

  -- MVP single-tenant per user -> 0 o 1 row. LIMIT 1 explicito para clarificar
  -- intencion (el UNIQUE en consultora_members ya garantiza maximo 1).
  select consultora_id, role
    into v_consultora_id, v_role
    from public.consultora_members
    where user_id = v_user_id
    limit 1;

  if v_consultora_id is null then
    -- User sin membership (signup en flight, user huerfano, etc.). Devolvemos
    -- event sin tocar: current_consultora_id() dara NULL, policies dan 0 rows,
    -- el client maneja el caso via fallback T-013.
    return event;
  end if;

  if v_claims -> 'app_metadata' is null then
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb, true);
  end if;

  v_claims := jsonb_set(
    v_claims,
    '{app_metadata,consultora_id}',
    to_jsonb(v_consultora_id::text),
    true
  );
  v_claims := jsonb_set(
    v_claims,
    '{app_metadata,consultora_role}',
    to_jsonb(v_role),
    true
  );

  return jsonb_set(event, '{claims}', v_claims, true);

exception when others then
  -- Critical path de auth: nunca tirar. raise warning (no notice) porque notice
  -- se suprime en muchos clientes; warning aparece prioritario en pg_log y es
  -- consumible via Sentry post follow-up T-016-FU1.
  raise warning 'custom_access_token_hook fallo para user %: % %',
    v_user_id, sqlstate, sqlerrm;
  return event;
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'T-016: Supabase Auth Hook. Inyecta app_metadata.consultora_id + consultora_role desde consultora_members. Defensive: si falla devuelve event sin tocar y emite raise warning.';


-- =============================================================================
-- GRANTS
-- =============================================================================
-- En prod GoTrue invoca el hook como supabase_auth_admin durante el token issue.
-- service_role solo para testing dev (smoke script). authenticated/anon NUNCA:
-- el hook lee consultora_members con security definer y podria filtrar tenancy
-- si fuera invocable por el cliente.

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin, service_role;
