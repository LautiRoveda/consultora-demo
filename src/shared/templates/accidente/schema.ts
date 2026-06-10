import { z } from 'zod';

import {
  camposPersonalizadosField,
  instruccionesAdicionalesField,
  normalizeCamposPersonalizados,
  normalizeInstruccionesAdicionales,
} from '../common/campos-extra';
import { normalizeCuit } from '../common/cuit';
import { HORA_HHMM_REGEX } from '../common/sanitize';
import { commonClientFields, fechaIsoField } from '../common/schema';

/**
 * T-022 · Schema del template Accidente laboral.
 *
 * 12 campos. Estructura:
 * - 3 campos identificacion cliente (commonClientFields — el lugar fisico
 *   especifico esta en `lugar_especifico`, no en localidad/provincia).
 * - 9 campos del suceso.
 *
 * IMPORTANTE: el render del informe NO inventa causa raiz ni nombres de
 * testigos (defensa contra alucinacion). El footer del prompt lo enfatiza.
 *
 * Categorias de lesion y partes del cuerpo: listas cerradas tomadas como
 * base de Anexo I Res. SRT 1604/07. "otros" como valve de escape.
 */

// =============================================================================
// CONSTANTES
// =============================================================================

export const TIPO_LESION = [
  { value: 'contusion', label: 'Contusión' },
  { value: 'herida_cortante', label: 'Herida cortante' },
  { value: 'fractura', label: 'Fractura' },
  { value: 'quemadura', label: 'Quemadura' },
  { value: 'esguince', label: 'Esguince / distensión' },
  { value: 'intoxicacion', label: 'Intoxicación' },
  { value: 'electrocucion', label: 'Electrocución' },
  { value: 'otros', label: 'Otros' },
] as const;
export type TipoLesion = (typeof TIPO_LESION)[number]['value'];
const TIPO_LESION_VALUES = [
  'contusion',
  'herida_cortante',
  'fractura',
  'quemadura',
  'esguince',
  'intoxicacion',
  'electrocucion',
  'otros',
] as const;

export const PARTES_CUERPO = [
  { value: 'cabeza', label: 'Cabeza' },
  { value: 'ojos', label: 'Ojos' },
  { value: 'miembros_superiores', label: 'Miembros superiores' },
  { value: 'manos', label: 'Manos' },
  { value: 'torax', label: 'Tórax' },
  { value: 'abdomen', label: 'Abdomen' },
  { value: 'miembros_inferiores', label: 'Miembros inferiores' },
  { value: 'espalda', label: 'Espalda / columna' },
  { value: 'otros', label: 'Otros' },
] as const;
export type ParteCuerpo = (typeof PARTES_CUERPO)[number]['value'];
const PARTES_CUERPO_VALUES = [
  'cabeza',
  'ojos',
  'miembros_superiores',
  'manos',
  'torax',
  'abdomen',
  'miembros_inferiores',
  'espalda',
  'otros',
] as const;

export const GRAVEDAD = [
  { value: 'leve', label: 'Leve (sin baja prolongada)' },
  { value: 'grave', label: 'Grave (baja prolongada)' },
  { value: 'grave_mortal', label: 'Grave / mortal' },
] as const;
export type Gravedad = (typeof GRAVEDAD)[number]['value'];
const GRAVEDAD_VALUES = ['leve', 'grave', 'grave_mortal'] as const;

// =============================================================================
// SCHEMA PRINCIPAL
// =============================================================================

export const accidenteMetadataSchema = z.object({
  // — IDENTIFICACION CLIENTE —
  ...commonClientFields(),

  // — SUCESO —
  fecha_accidente: fechaIsoField,

  hora_accidente: z.string().regex(HORA_HHMM_REGEX, { message: 'Formato HH:MM (24h).' }),

  lugar_especifico: z
    .string()
    .trim()
    .min(3, { message: 'Mínimo 3 caracteres.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),

  puesto_afectado: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(120, { message: 'Máximo 120 caracteres.' }),

  // — LESION —
  tipo_lesion: z
    .array(z.enum(TIPO_LESION_VALUES))
    .min(1, { message: 'Marcá al menos un tipo de lesión.' })
    .max(8, { message: 'Máximo 8 tipos.' }),

  partes_cuerpo_afectadas: z
    .array(z.enum(PARTES_CUERPO_VALUES))
    .min(1, { message: 'Marcá al menos una parte del cuerpo afectada.' })
    .max(9, { message: 'Máximo 9 partes.' }),

  gravedad: z.enum(GRAVEDAD_VALUES, { message: 'Elegí una gravedad.' }),

  /**
   * Opcional. Numero entero, 0 a 365 dias. Con RHF: el `<Input>` debe enviar
   * `undefined` (no NaN) cuando el campo esta vacio para que `.optional()`
   * matchee — defaults pone `undefined` y el onChange handler convierte
   * '' → undefined.
   */
  dias_baja_estimados: z
    .number({ message: 'Ingresá un número.' })
    .int({ message: 'Debe ser un número entero de días.' })
    .min(0, { message: 'Mínimo 0 días.' })
    .max(365, { message: 'Máximo 365 días.' })
    .optional(),

  testigos_presentes: z.boolean(),

  descripcion_inicial: z
    .string()
    .trim()
    .min(10, { message: 'Mínimo 10 caracteres — describí brevemente el accidente.' })
    .max(4000, { message: 'Máximo 4000 caracteres.' }),

  // — PERSONALIZACION (T-138 fase 1, compartida por los 5 tipos) —
  // Aditiva: agrega datos/foco al user message; la estructura legal del
  // informe de accidente NO es configurable.
  campos_personalizados: camposPersonalizadosField(),
  instrucciones_adicionales: instruccionesAdicionalesField(),
});

export type AccidenteMetadata = z.infer<typeof accidenteMetadataSchema>;

// =============================================================================
// NORMALIZADOR
// =============================================================================

export function normalizeAccidenteMetadata(m: AccidenteMetadata): AccidenteMetadata {
  return {
    ...m,
    cuit: normalizeCuit(m.cuit),
    // `dias_baja_estimados` ya viene como number | undefined del schema; nada que limpiar.
    campos_personalizados: normalizeCamposPersonalizados(m.campos_personalizados),
    instrucciones_adicionales: normalizeInstruccionesAdicionales(m.instrucciones_adicionales),
  };
}

// =============================================================================
// LOOKUPS
// =============================================================================

const TIPO_LESION_LABEL_BY_VALUE: Record<TipoLesion, string> = Object.fromEntries(
  TIPO_LESION.map((t) => [t.value, t.label]),
) as Record<TipoLesion, string>;

export function tipoLesionLabel(value: TipoLesion): string {
  return TIPO_LESION_LABEL_BY_VALUE[value];
}

const PARTE_CUERPO_LABEL_BY_VALUE: Record<ParteCuerpo, string> = Object.fromEntries(
  PARTES_CUERPO.map((p) => [p.value, p.label]),
) as Record<ParteCuerpo, string>;

export function parteCuerpoLabel(value: ParteCuerpo): string {
  return PARTE_CUERPO_LABEL_BY_VALUE[value];
}

const GRAVEDAD_LABEL_BY_VALUE: Record<Gravedad, string> = Object.fromEntries(
  GRAVEDAD.map((g) => [g.value, g.label]),
) as Record<Gravedad, string>;

export function gravedadLabel(value: Gravedad): string {
  return GRAVEDAD_LABEL_BY_VALUE[value];
}
