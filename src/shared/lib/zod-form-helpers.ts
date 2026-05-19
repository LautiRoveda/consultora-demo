import { z } from 'zod';

/**
 * T-054 · Helper Zod reusable para fields opcionales de forms RHF.
 *
 * Promovido desde `ClienteForm.tsx` T-049 (donde vivía como `optionalText`).
 * Razón: el form de empleados T-054 lo necesita igual, y otros forms futuros
 * (informes/EPP) van a tener la misma necesidad — accept `''` como "no cargado"
 * + valor in-range si el user lo completa.
 *
 * **Patrón Zod-RHF**: schemas de action (T-048/T-053) rechazan `''` en fields
 * `.optional()` (min ≥ 1). Pero RHF necesita defaults string para evitar
 * uncontrolled→controlled warning. Este helper crea el schema permisivo del
 * form; `stripEmpty()` / `diffPatch()` del caller convierten al shape del
 * action antes del invoke.
 */
export function optionalString({
  min = 1,
  max,
  label,
}: {
  min?: number;
  max: number;
  label: string;
}) {
  return z
    .string()
    .trim()
    .refine((v) => v === '' || (v.length >= min && v.length <= max), {
      message: `Si lo completás, ${label} debe tener entre ${min} y ${max} caracteres.`,
    });
}
