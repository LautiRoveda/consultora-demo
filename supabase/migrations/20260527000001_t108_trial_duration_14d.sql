-- T-108 · Bump trial duration 7d -> 14d.
--
-- Re-emision idempotente de create_consultora_and_owner() con el unico cambio
-- en el `interval` del INSERT (7 days -> 14 days). Forward-only: consultoras
-- existentes con trial_hasta ya seteado a 7d NO se backfillan. Backfill seria
-- riesgoso (resucitaria trials caducados de cuentas que ya migraron a pago o
-- expiraron). Future signups arrancan con 14 dias.
--
-- Patron de re-emision verbatim alineado con T-070
-- (20260520000001_t070_pagos_schema.sql lineas 50-102): mismo body, mismo
-- shape, unico cambio el interval literal.
--
-- App-layer: src/shared/lib/trial-days.ts exporta TRIAL_DAYS = 14 como
-- constante para copy/UI. Source of truth REAL es esta funcion SQL — si
-- cambia aca, hay que sincronizar la constante TS (y al reves).
--
-- Ver tambien: docs/adr/0014-landing-pricing-ars-plan-unico.md.


-- =============================================================================
-- Re-emision create_consultora_and_owner con interval 14 days
-- =============================================================================

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
      insert into public.consultoras (name, slug, plan, trial_hasta)
      values (p_name, v_slug_candidate, 'trial', now() + interval '14 days')  -- T-108: 7d -> 14d
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


-- =============================================================================
-- Comment update reflejando trial nuevo
-- =============================================================================

comment on column public.consultoras.trial_hasta is
  'Fin del trial 14d post-signup (T-108, antes 7d). NULL una vez que la consultora migra a plan pago.';
