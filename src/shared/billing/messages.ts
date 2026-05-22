import type { BillingGateReason } from './access';

/**
 * T-073 · Mensajes user-facing del trial gate.
 * Consumido por (a) las actions/API routes en el campo `message` del response,
 * y (b) el `<BillingGateBanner>` para renderizar el texto del banner.
 */
export function getGateMessage(reason: BillingGateReason): string {
  switch (reason) {
    case 'TRIAL_EXPIRED':
      return 'Tu trial venció. Suscribite para seguir creando informes y clientes.';
    case 'SUBSCRIPTION_EXPIRED':
      return 'Tu suscripción expiró. Reactivá para seguir usando ConsultoraDemo.';
    case 'SUBSCRIPTION_CANCELLED':
      return 'Tu suscripción está cancelada. Reactivá si querés seguir.';
  }
}
