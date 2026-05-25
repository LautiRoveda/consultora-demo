-- CHORE-D · I1 · Extender unique partial a 'pendiente_autorizacion'.
--
-- Pre-existente (migration 20260520000001 línea 161-163):
--   unique (consultora_id) where estado in ('trial', 'activa', 'morosa');
--
-- Gap: 2 clicks simultáneos en "Suscribirme" pasan el check de
-- getActiveSubscription antes que cualquiera de los 2 INSERTs llegue al DB,
-- 2 rows con estado 'pendiente_autorizacion' + 2 preapprovals creados en MP,
-- 2 cobros si MP autoriza ambos.
--
-- Fix: incluir 'pendiente_autorizacion' en el WHERE del index. Cualquier
-- INSERT concurrente posterior al primero recibe 23505 (unique_violation),
-- que el caller refactorizado captura y devuelve initPoint del ganador.

drop index if exists public.uniq_suscripciones_consultora_activa;

create unique index uniq_suscripciones_consultora_activa
  on public.suscripciones (consultora_id)
  where estado in ('trial', 'pendiente_autorizacion', 'activa', 'morosa');

comment on index public.uniq_suscripciones_consultora_activa is
  'CHORE-D · I1. Bloquea 2 suscripciones simultáneas activas o pendientes para la misma consultora. Trial/activa/morosa: defensa pre-existente. Pendiente_autorizacion: defensa contra race del flow createSubscriptionAction.';
