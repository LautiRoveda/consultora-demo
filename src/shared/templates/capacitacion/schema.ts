import { z } from 'zod';

import { normalizeCuit } from '../common/cuit';
import { commonClientFields, fechaIsoField } from '../common/schema';

/**
 * T-022 · Schema del template Capacitación.
 *
 * 10 campos. Estructura:
 * - 3 campos de identificacion cliente (commonClientFields, sin sitio — la
 *   capacitacion puede ser virtual o en aula externa, el domicilio del
 *   cliente es referencia administrativa).
 * - 7 campos especificos de la actividad formativa.
 *
 * Patron canonico (docs/technical/07-zod-rhf-gotchas.md):
 * - Sin coerce/preprocess/transform en el schema.
 * - Opcionales que aceptan '' desde RHF: trim().max().optional() para strings
 *   simples; refine + optional cuando hay regex.
 * - Normalizacion de '' → undefined vive en `normalizeCapacitacionMetadata`,
 *   no en `.transform()`.
 */

// =============================================================================
// CONSTANTES (espejo de option lists del UI form)
// =============================================================================

export const MODALIDAD_CAPACITACION = [
  { value: 'presencial', label: 'Presencial' },
  { value: 'virtual', label: 'Virtual' },
  { value: 'mixta', label: 'Mixta (semi-presencial)' },
] as const;
export type ModalidadCapacitacion = (typeof MODALIDAD_CAPACITACION)[number]['value'];
const MODALIDAD_VALUES = ['presencial', 'virtual', 'mixta'] as const;

// =============================================================================
// SCHEMA PRINCIPAL
// =============================================================================

export const capacitacionMetadataSchema = z.object({
  // — IDENTIFICACION CLIENTE —
  ...commonClientFields(),

  // — ACTIVIDAD FORMATIVA —
  fecha_capacitacion: fechaIsoField,

  modalidad: z.enum(MODALIDAD_VALUES, { message: 'Elegí una modalidad.' }),

  /**
   * Duración en horas. Permite decimales (`z.number()` sin `.int()`) para
   * cursos cortos de 30 minutos (0.5). Cap superior 40h: charlas largas
   * pero plausibles. Sin coerce — el `<Input type="number">` castea manual.
   */
  duracion_horas: z
    .number({ message: 'Ingresá un número.' })
    .min(0.5, { message: 'Mínimo 0,5 horas.' })
    .max(40, { message: 'Máximo 40 horas.' }),

  tema_principal: z
    .string()
    .trim()
    .min(3, { message: 'Mínimo 3 caracteres.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),

  capacitador_nombre: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(120, { message: 'Máximo 120 caracteres.' }),

  /**
   * Opcional. Formatos AR no son uniformes (MN 12345, M.P. 1234, MAT-12345,
   * solo numero, etc.) — no validamos regex, solo cap de longitud. Acepta ''
   * desde RHF (refine `v === '' || v.length >= 2` redundante con `.optional`).
   */
  capacitador_matricula: z.string().trim().max(40, { message: 'Máximo 40 caracteres.' }).optional(),

  cantidad_asistentes_prevista: z
    .number({ message: 'Ingresá un número.' })
    .int({ message: 'Cantidad de asistentes debe ser un número entero.' })
    .min(1, { message: 'Mínimo 1 asistente.' })
    .max(1000, { message: 'Máximo 1000 asistentes.' }),

  /** Opcional. Resumen narrativo de contenidos. */
  contenidos_resumen: z
    .string()
    .trim()
    .max(2000, { message: 'Máximo 2000 caracteres.' })
    .optional(),
});

export type CapacitacionMetadata = z.infer<typeof capacitacionMetadataSchema>;

// =============================================================================
// NORMALIZADOR
// =============================================================================

/**
 * Limpia el payload pre-persist:
 * - CUIT normalizado a XX-XXXXXXXX-X.
 * - Strings opcionales vacios ('') → undefined (jsonb mas limpio).
 */
export function normalizeCapacitacionMetadata(m: CapacitacionMetadata): CapacitacionMetadata {
  return {
    ...m,
    cuit: normalizeCuit(m.cuit),
    capacitador_matricula:
      m.capacitador_matricula && m.capacitador_matricula.length > 0
        ? m.capacitador_matricula
        : undefined,
    contenidos_resumen:
      m.contenidos_resumen && m.contenidos_resumen.length > 0 ? m.contenidos_resumen : undefined,
  };
}

// =============================================================================
// LOOKUPS (para render + UI)
// =============================================================================

const MODALIDAD_LABEL_BY_VALUE: Record<ModalidadCapacitacion, string> = Object.fromEntries(
  MODALIDAD_CAPACITACION.map((m) => [m.value, m.label]),
) as Record<ModalidadCapacitacion, string>;

export function modalidadCapacitacionLabel(value: ModalidadCapacitacion): string {
  return MODALIDAD_LABEL_BY_VALUE[value];
}
