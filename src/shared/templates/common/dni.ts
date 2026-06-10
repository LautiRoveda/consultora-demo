import { z } from 'zod';

/**
 * T-054 · DNI regex + normalizador + formatter.
 *
 * Promovido desde inline en `empleados/actions.ts` + `empleados/queries.ts`
 * (T-053) para que UI + actions + queries compartan la misma regla. Matchea
 * patrón `cuit.ts` T-022.
 *
 * NOTA RHF: `normalizeDni` se invoca POST-validate (action pre-persist + form
 * onBlur opcional). Nunca dentro del schema via `.transform()` — rompe la
 * inferencia de RHF (mismo gotcha que CUIT, ver `docs/technical/07-zod-rhf-gotchas.md`).
 */

/**
 * Acepta DNI con o sin puntos/espacios/guiones. Rango 7-12 chars (7 dígitos
 * puros hasta 11 chars con 4 separadores). La normalizacion canoniza a digits
 * only matcheando CHECK SQL `^\d{7,8}$`.
 */
export const DNI_REGEX_INPUT = /^\d[\d.\s-]{6,11}$/;

/** Forma canónica post-normalización — espejo 1:1 del CHECK SQL `^\d{7,8}$` (empleados:46). */
const DNI_REGEX_CANONICAL = /^\d{7,8}$/;

/** Schema field reusable: DNI validado por regex permisivo. */
export const dniField = z
  .string()
  .trim()
  .regex(DNI_REGEX_INPUT, {
    message: 'DNI inválido. Formato: 7-8 dígitos (con o sin puntos/espacios).',
  })
  // T-135 (L-2) · El regex permisivo tolera separadores hasta 12 chars, pero
  // también deja pasar 9-12 dígitos puros que recién revientan en el CHECK SQL
  // con error genérico. El refine cierra el rango real post-normalización.
  // .refine y NO .transform: transform rompe la inferencia RHF (07-zod-rhf-gotchas).
  .refine((v) => DNI_REGEX_CANONICAL.test(normalizeDni(v)), {
    message: 'El DNI debe tener 7 u 8 dígitos.',
  });

/**
 * DNI con separadores → digits-only. Idempotente.
 * Input '12.345.678' → '12345678'. Input '12345678' → '12345678'.
 */
export function normalizeDni(raw: string): string {
  return raw.replace(/[.\s-]/g, '').trim();
}

/**
 * DNI digits-only → display 'XX.XXX.XXX' (8 digitos) o 'X.XXX.XXX' (7 digitos).
 * Si el input no tiene 7 u 8 digitos exactos, devuelve sin cambios (fallback
 * defensivo — los rows de DB ya cumplen CHECK `^\d{7,8}$`).
 */
export function formatDni(normalized: string): string {
  if (!DNI_REGEX_CANONICAL.test(normalized)) return normalized;
  if (normalized.length === 8) {
    return `${normalized.slice(0, 2)}.${normalized.slice(2, 5)}.${normalized.slice(5, 8)}`;
  }
  return `${normalized.slice(0, 1)}.${normalized.slice(1, 4)}.${normalized.slice(4, 7)}`;
}
