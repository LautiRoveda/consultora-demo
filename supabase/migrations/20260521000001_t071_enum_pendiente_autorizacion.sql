-- T-071 · Enum value 'pendiente_autorizacion' para estado_suscripcion
-- Estado intermedio entre INSERT del row (post createSubscriptionAction) y
-- webhook MP subscription_preapproval con status=authorized.
--
-- Posición: antes de 'activa' (orden lógico del lifecycle).
-- Idempotente vía `if not exists`. Solo agrega value, ningún row lo usa todavía
-- → seguro en transacción (PG 12+ permite ADD VALUE en mismo tx si no se usa).

alter type public.estado_suscripcion add value if not exists 'pendiente_autorizacion' before 'activa';
