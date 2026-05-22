/**
 * T-072 · Formato monetario ARS desde centavos.
 *
 * `monto_centavos` en `facturas` + `ARS_PRICE_MONTHLY` en env son enteros
 * en centavos (3000000 = ARS 30.000). Convertimos a string con separador de
 * miles es-AR y prefijo "ARS". Sin decimales: el negocio cobra montos
 * redondos en pesos y los centavos del PSP son ruido visual.
 *
 * Reuso: T-072 BillingView + T-074 dunning emails Resend.
 */
export function formatARS(centavos: number): string {
  const pesos = Math.round(centavos / 100);
  return `ARS ${pesos.toLocaleString('es-AR')}`;
}
