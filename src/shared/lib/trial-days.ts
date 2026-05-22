/**
 * T-072 · Días restantes del trial.
 *
 * `trialHasta` es un ISO timestamp persistido en `consultoras.trial_hasta`.
 * El cálculo es CLIENT-SIDE (basado en `Date.now()` del browser) para que
 * cambie con el día real del usuario sin esperar el próximo SSR.
 *
 * `Math.ceil` redondea para que "vence en 6 horas" se muestre como "1d"
 * (no como "0d"), evitando el flash de "Trial vencido" sobre un trial que
 * todavía es válido hasta la noche.
 *
 * Devuelve `null` si no hay `trialHasta` (consultora no-trial). Negativo o
 * cero indica trial vencido — el caller decide cómo renderizar.
 */
export function trialDaysLeft(trialHasta: string | null, now: Date = new Date()): number | null {
  if (!trialHasta) return null;
  const target = new Date(trialHasta).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - now.getTime()) / 86_400_000);
}
