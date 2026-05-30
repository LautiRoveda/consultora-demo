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

/**
 * T-108 · Formato monetario ARS mensual ("ARS 30.000/mes").
 *
 * Wrapper sobre `formatARS` para los call-sites que displayean precio del
 * plan (landing + emails dunning + billing view). Toma centavos como input
 * para mantener un solo source-of-truth de la representación monetaria.
 *
 * Caller pasa `Number(env.ARS_PRICE_MONTHLY)` desde server-side (cron,
 * server actions, route handlers). Para client components, pasar el valor
 * inlinado via prop o constante hardcoded en copy estático.
 */
export function formatARSMonthly(centavos: number): string {
  return `${formatARS(centavos)}/mes`;
}
