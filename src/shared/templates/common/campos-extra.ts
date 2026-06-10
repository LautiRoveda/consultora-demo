import { z } from 'zod';

/**
 * T-138 fase 1 · Campos de personalizacion compartidos por los 5 templates.
 *
 * Mecanismo aditivo: el consultor agrega pares label/valor propios de su
 * laburo (numero de expediente, norma interna, referente de planta, etc.) y
 * una instruccion libre de estilo/foco para el borrador. NO toca la
 * estructura del informe (eso es fase 2, solo tipos sin estructura legal).
 *
 * Todos los campos son `.optional()` — la metadata persistida pre-T-138
 * parsea sin cambios (backward-compat sin migracion, jsonb libre).
 *
 * Seguridad: estos valores son user-controlled y se inyectan al user message
 * del Claude API call. Los caps de longitud acotan el costo en tokens; la
 * sanitizacion vive en el render (`common/render-extra.ts`), no aca.
 *
 * IMPORTANT: NO `'use server'` ni `'use client'` — se importa desde schemas
 * (ambos contextos). Sin coerce/preprocess/transform (07-zod-rhf-gotchas).
 */

export const CAMPOS_PERSONALIZADOS_MAX = 10;
export const CAMPO_LABEL_MAX = 60;
export const CAMPO_VALOR_MAX = 500;
export const INSTRUCCIONES_ADICIONALES_MAX = 1500;

export const campoPersonalizadoSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, { message: 'Etiqueta vacía no permitida.' })
    .max(CAMPO_LABEL_MAX, { message: `Etiqueta: máximo ${CAMPO_LABEL_MAX} caracteres.` }),
  valor: z
    .string()
    .trim()
    .min(1, { message: 'Valor vacío no permitido.' })
    .max(CAMPO_VALOR_MAX, { message: `Valor: máximo ${CAMPO_VALOR_MAX} caracteres.` }),
});

export type CampoPersonalizado = z.infer<typeof campoPersonalizadoSchema>;

/**
 * Factory — cada `<tipo>MetadataSchema` lo spreadea. Caps: 10 campos de
 * 60+500 chars ≈ 1.5k tokens peor caso, acotado para no desplazar el foco
 * del modelo ni inflar el costo por generacion.
 */
export const camposPersonalizadosField = () =>
  z
    .array(campoPersonalizadoSchema)
    .max(CAMPOS_PERSONALIZADOS_MAX, {
      message: `Máximo ${CAMPOS_PERSONALIZADOS_MAX} campos personalizados.`,
    })
    .optional();

/**
 * Factory — instruccion libre de estilo/foco. Cap 1500 < 2000 del userPrompt
 * existente: la instruccion persistida es complemento, no reemplazo, de las
 * "Notas adicionales" por generacion.
 */
export const instruccionesAdicionalesField = () =>
  z
    .string()
    .trim()
    .max(INSTRUCCIONES_ADICIONALES_MAX, {
      message: `Máximo ${INSTRUCCIONES_ADICIONALES_MAX} caracteres.`,
    })
    .optional();

/**
 * `[]` (default RHF) → undefined: jsonb lean, y el render trata ausente y
 * vacio igual (no emite bloque). Idempotente.
 */
export function normalizeCamposPersonalizados(
  campos: CampoPersonalizado[] | undefined,
): CampoPersonalizado[] | undefined {
  return campos && campos.length > 0 ? campos : undefined;
}

/** `''` (default RHF) → undefined. Idempotente. */
export function normalizeInstruccionesAdicionales(
  instrucciones: string | undefined,
): string | undefined {
  return instrucciones && instrucciones.length > 0 ? instrucciones : undefined;
}
