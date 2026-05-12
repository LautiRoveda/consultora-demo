import { z } from 'zod';

/**
 * T-022 · CUIT regex + normalizador.
 *
 * Promovido desde `rgrl/schema.ts` (T-021) para que los 5 schemas de template
 * compartan la misma regla. No validamos digito verificador (modulo 11) — eso
 * vive en deuda forward T-029.
 *
 * NOTA RHF: `normalizeCuit` se invoca POST-validate (form onBlur + action
 * pre-persist). Nunca dentro del schema via `.transform()` — rompe la
 * inferencia de RHF (ver `docs/technical/07-zod-rhf-gotchas.md`).
 */

/** Acepta CUIT con o sin guiones. La normalizacion canoniza a XX-XXXXXXXX-X. */
export const CUIT_REGEX = /^\d{2}-?\d{8}-?\d{1}$/;

/** Schema field reusable: CUIT validado por regex. */
export const cuitField = z
  .string()
  .trim()
  .regex(CUIT_REGEX, { message: 'Formato CUIT: XX-XXXXXXXX-X (con o sin guiones).' });

/**
 * CUIT con o sin guiones → XX-XXXXXXXX-X. Si no tiene 11 digitos exactos,
 * devuelve el input original sin cambios (el regex del schema rechaza al
 * validar). Idempotente.
 */
export function normalizeCuit(raw: string): string {
  const digits = raw.replace(/-/g, '').trim();
  if (!/^\d{11}$/.test(digits)) return raw;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10, 11)}`;
}
