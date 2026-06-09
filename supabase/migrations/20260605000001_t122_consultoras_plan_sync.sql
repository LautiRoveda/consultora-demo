-- =============================================================================
-- T-122 · Sync suscripciones.estado -> consultoras.plan + trial_hasta (+ backfill).
-- =============================================================================
-- PORQUE: consultoras.plan (text CHECK in trial/pro/team/enterprise) + trial_hasta
-- son un CACHE denormalizado de la suscripción MP (el comentario de la columna en
-- T-070 dice "Denormalizado desde suscripciones... via webhook MP"). Pero NINGÚN
-- write path lo mantiene: el webhook handlePreapprovalEvent updatea
-- suscripciones.estado y NO toca consultoras; createSubscriptionAction /
-- cancelSubscriptionAction tampoco. Resultado: una consultora que paga queda
-- plan='trial' para siempre -> el badge de trial del sidebar miente y el cron de
-- dunning (filtra .eq('plan','trial').gte('trial_hasta',...)) le manda "tu trial
-- vence" a un cliente que paga. El gate (src/shared/billing/access.ts) NO se ve
-- afectado porque lee suscripciones primero; el daño es UI + dunning.
--
-- Esta es la Clase A de ADR-0015 (cache denormalizado drifteando de su fuente de
-- verdad), misma forma que T-118 (calendar_events -> dominio): fuente única + sync
-- por trigger.
--
-- FIX (1 migración, orden importa):
--   (1) función + trigger AFTER INSERT OR UPDATE OF estado que recomputa
--       consultoras.plan/trial_hasta desde el estado VIGENTE de la consultora.
--       Cubre TODO write path (webhook + actions + futuro + SQL/backfill) en la
--       MISMA transacción.
--   (2) backfill idempotente (promote-only) de las filas ya driftadas.
--   (3) corregir los comentarios engañosos de consultoras.plan / trial_hasta.
--
-- MAPEO (estado pago-significativo -> pro):
--   estado in (activa, morosa, cancelada) -> plan='pro',  trial_hasta=NULL
--   resto (trial, pendiente_autorizacion, expirada)       -> plan='trial' (trial_hasta intacto)
--   'pro' es el ÚNICO valor pago del CHECK de consultoras.plan ('pro_mensual' es el
--   enum plan_codigo, OTRA cosa: escribirlo violaría el CHECK).
--   El gap "plan='pro' tras cancelar_en" (cliente fully-churned) es intencional acá;
--   el flip a no-pago es el churn reaper T-124. El audit de los flips de plan es T-121.
--
-- VIGENTE, no NEW: recomputamos con un EXISTS sobre TODAS las suscripciones de la
-- consultora (no solo la fila del evento). Una consultora puede tener canceladas/
-- expiradas históricas conviviendo con la viva (el índice parcial
-- uniq_suscripciones_consultora_activa garantiza <=1 fila en {trial,activa,morosa};
-- cancelada/expirada conviven). Así un evento stale sobre una fila histórica NO
-- degrada a una consultora que sigue 'activa'. Dado el mapeo, "la de mayor jerarquía
-- de estado" colapsa a "¿tiene alguna suscripción pago-significativa?".
--
-- NO-RECURSIÓN: el único trigger sobre public.consultoras es before-update
-- set_updated_at; nada en consultoras escribe suscripciones, y esta función escribe
-- SOLO consultoras -> el grafo termina, no cicla.
--
-- SEGURIDAD: security definer + search_path='' (el UPDATE de consultoras es
-- service_role-only por RLS). Cross-tenant-safe: toca SOLO la fila
-- id = NEW.consultora_id. Sin grants (espeja T-118: las trigger functions se
-- disparan, no se invocan; el privilegio viene del owner via security definer).
-- =============================================================================

create or replace function public.sync_consultora_plan_from_suscripcion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
begin
  -- VIGENTE: ¿la consultora tiene alguna suscripción pago-significativa?
  v_plan := case
    when exists (
      select 1
        from public.suscripciones s
       where s.consultora_id = new.consultora_id
         and s.estado in ('activa', 'morosa', 'cancelada')
    ) then 'pro'
    else 'trial'
  end;

  if v_plan = 'pro' then
    -- Rama pro: plan='pro' + trial_hasta=NULL. Guard is-distinct-from =
    -- idempotente (no churnea consultoras.updated_at en webhooks repetidos).
    update public.consultoras
       set plan = 'pro',
           trial_hasta = null
     where id = new.consultora_id
       and (plan is distinct from 'pro' or trial_hasta is not null);
  else
    -- Rama trial: plan='trial' SIN tocar trial_hasta (preserva el deadline real de
    -- signup que el cron de dunning necesita; no otorga pro optimista en pendiente).
    update public.consultoras
       set plan = 'trial'
     where id = new.consultora_id
       and plan is distinct from 'trial';
  end if;

  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$$;

comment on function public.sync_consultora_plan_from_suscripcion() is
  'T-122: AFTER INSERT/UPDATE OF estado en suscripciones. Mantiene el cache '
  'denormalizado consultoras.plan/trial_hasta en sync con la suscripción VIGENTE de '
  'la consultora: si tiene alguna suscripción en (activa,morosa,cancelada) -> '
  'plan=pro + trial_hasta=NULL; sino plan=trial sin tocar trial_hasta. Guard '
  'is-distinct-from = idempotente. security definer bypassa RLS (cross-tenant-safe: '
  'solo toca id = NEW.consultora_id). No cicla: consultoras no escribe suscripciones. '
  'El churn reaper (plan=pro tras cancelar_en) es T-124; el audit de flips es T-121.';

-- AFTER INSERT OR UPDATE OF estado: el UPDATE solo dispara si estado está en el SET
-- (cancelSubscriptionAction setea solo cancelar_en -> NO dispara; set_updated_at
-- tampoco). El INSERT cubre altas con estado ya pago. Sin WHEN (OLD no existe en
-- INSERT); el guard is-distinct-from dentro de la función hace el no-op cuando ya
-- coincide.
drop trigger if exists sync_consultora_plan_after_change on public.suscripciones;
create trigger sync_consultora_plan_after_change
  after insert or update of estado on public.suscripciones
  for each row
  execute function public.sync_consultora_plan_from_suscripcion();

-- =============================================================================
-- BACKFILL T-122 (promote-only, idempotente): consultoras hoy en plan='trial' con
-- alguna suscripción en (activa, morosa, cancelada) -> 'pro' + trial_hasta=NULL.
-- Promote-only: solo toca plan='trial' (no degrada nada). Idempotente: tras correr,
-- esas filas son 'pro' -> el filtro plan='trial' las excluye -> re-run = 0 rows.
-- =============================================================================
do $$
declare
  v_count int := 0;
begin
  update public.consultoras c
     set plan = 'pro',
         trial_hasta = null
   where c.plan = 'trial'
     and exists (
       select 1
         from public.suscripciones s
        where s.consultora_id = c.id
          and s.estado in ('activa', 'morosa', 'cancelada')
     );
  get diagnostics v_count = row_count;
  raise notice 'T-122 backfill: % consultoras promovidas a plan=pro (trial_hasta NULL)', v_count;
end $$;

-- =============================================================================
-- Corregir los comentarios engañosos de consultoras.plan / trial_hasta.
-- =============================================================================
comment on column public.consultoras.plan is
  'trial (14 dias post-signup, T-108) | pro (plan pago MP) | team (Fase 2) | '
  'enterprise (Fase 4). CACHE denormalizado de suscripciones.estado, mantenido por '
  'el trigger sync_consultora_plan_after_change (T-122): suscripción en '
  '(activa,morosa,cancelada) -> pro. Lo leen el badge de trial del sidebar y el '
  'filtro del cron de dunning; el gate (access.ts) lee suscripciones directo.';

comment on column public.consultoras.trial_hasta is
  'Fin del trial 14d post-signup (T-108). NULL cuando la consultora pasa a pago (lo '
  'setea el trigger T-122 al promover a pro). El cron de dunning filtra '
  '.eq(plan,trial).gte(trial_hasta) -> NULL excluye la fila (correcto: un cliente '
  'que paga no recibe dunning de trial).';
