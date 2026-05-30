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

/**
 * T-108 · Duración del trial post-signup, en días.
 *
 * **Source of truth real** es la función SQL `create_consultora_and_owner()`
 * (ver `supabase/migrations/20260527000001_t108_trial_duration_14d.sql`).
 * Esta constante existe para que copy/UI/metadata consuman el número sin
 * re-hardcodearlo. Si bumpés acá, **bumpá también la migration**, y al revés.
 *
 * Bump 7 → 14 (T-108): decisión comercial para reducir fricción de
 * conversión orgánica. Trade-off documentado en ADR-0014.
 */
export const TRIAL_DAYS = 14 as const;
