-- T-012 · Signup flow: RPC atómica create_consultora_and_owner + extension unaccent.
--
-- Llamada desde una server action AFTER `supabase.auth.signUp()`. Crea consultora
-- (con slug normalizado + trial 7d) + consultora_members (role='owner') en una
-- sola transaccion. Si falla, la server action hace cleanup del auth.users
-- recien creado via service-role (admin.auth.admin.deleteUser).
--
-- Ver tambien: docs/technical/02-architecture.md modulo Tenancy + T-012 PR body.


-- =============================================================================
-- EXTENSIONS
-- =============================================================================

-- unaccent: necesaria para normalizar el slug de nombres con acentos (es-AR).
-- Ej: "Consultoria Perez" pasa por unaccent -> "Consultoria Perez" (sin tildes),
-- despues por regexp y lower -> "consultoria-perez".
create extension if not exists unaccent;


-- =============================================================================
-- FUNCION: create_consultora_and_owner
-- =============================================================================
--
-- Crea consultora + membership 'owner' atomicamente.
--
-- Slug: lower + unaccent + regex no-alfanum -> '-' + collapse + suffix random
-- de 4 chars hex. Loop de hasta 5 intentos por colision (UNIQUE slug). Si no
-- encuentra slug libre, raise. Probabilidad real de colision: 5*16^4 = 327K
-- combos por base; con base "consultoria" + 5 retries hay que tener decenas de
-- miles de signups con el mismo nombre exacto. MVP: aceptable.
--
-- - security definer + search_path = '': patron Supabase canonico. Bypasa RLS
--   sin inyeccion de search_path. Todos los nombres calificados con `public.`.
-- - revoke from anon: el caller debe estar authenticated (signUp ya recien creo
--   el auth.users y el JWT del request lo lleva). service_role tambien puede
--   (testing + migration scripts futuros).
-- - returns table: el caller recibe consultora_id + slug para audit/log.
create or replace function public.create_consultora_and_owner(
  p_user_id uuid,
  p_name    text
)
returns table (consultora_id uuid, slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug_base      text;
  v_slug_candidate text;
  v_suffix         text;
  v_consultora_id  uuid;
  v_attempts       int := 0;
begin
  -- Normalizacion del slug base (sin sufijo).
  v_slug_base := lower(public.unaccent(p_name));
  v_slug_base := regexp_replace(v_slug_base, '[^a-z0-9]+', '-', 'g');
  v_slug_base := regexp_replace(v_slug_base, '^-+|-+$', '', 'g');
  if length(v_slug_base) < 1 then
    v_slug_base := 'consultora';
  end if;
  -- Truncar a 55 chars para dar margen al sufijo '-XXXX' (5 chars) -> total 60,
  -- que matchea el CHECK length(slug) <= 60 en public.consultoras.
  v_slug_base := substr(v_slug_base, 1, 55);

  -- Loop con retry por colision.
  loop
    v_attempts := v_attempts + 1;
    v_suffix := substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    v_slug_candidate := v_slug_base || '-' || v_suffix;
    begin
      insert into public.consultoras (name, slug, plan_tier, trial_ends_at)
      values (p_name, v_slug_candidate, 'trial', now() + interval '7 days')
      returning id into v_consultora_id;
      exit;  -- success: salimos del loop
    exception when unique_violation then
      if v_attempts >= 5 then
        raise exception 'No se pudo generar slug unico para %', p_name
          using errcode = 'unique_violation';
      end if;
      -- continue loop: probamos otro sufijo
    end;
  end loop;

  -- Membership del creador como owner.
  insert into public.consultora_members (user_id, consultora_id, role)
  values (p_user_id, v_consultora_id, 'owner');

  return query select v_consultora_id, v_slug_candidate;
end;
$$;

comment on function public.create_consultora_and_owner(uuid, text) is
  'Signup atomico: crea consultora (trial 7d, slug normalizado + suffix) + consultora_members (owner). Invocada desde server action post-signUp. Ver T-012.';

-- Permisos: solo authenticated + service_role. anon no puede (no tiene auth.uid()).
revoke all on function public.create_consultora_and_owner(uuid, text) from public, anon;
grant execute on function public.create_consultora_and_owner(uuid, text) to authenticated, service_role;
