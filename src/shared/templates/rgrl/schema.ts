import { z } from 'zod';

import {
  camposPersonalizadosField,
  instruccionesAdicionalesField,
  normalizeCamposPersonalizados,
  normalizeInstruccionesAdicionales,
} from '../common/campos-extra';
import { normalizeCuit } from '../common/cuit';
import { commonClientFieldsWithSite, fechaIsoField } from '../common/schema';

/**
 * T-021 · Schema + constantes del template RGRL (Relevamiento General de
 * Riesgos Laborales).
 *
 * T-022 · Refactor backward-compat: adopta `commonClientFieldsWithSite()` y
 * `fechaIsoField` del modulo common. Las keys jsonb persistidas son
 * IDENTICAS a T-021 (razon_social, cuit, domicilio, localidad, provincia,
 * fecha_relevamiento), por lo que la metadata existente en remote sigue
 * parseando sin migracion de datos.
 *
 * NO `'use server'` — se importa desde Client Components (RHF + zodResolver)
 * y desde el render helper. Si fuera server, Next.js convierte los exports
 * en RSC proxies y zodResolver rompe.
 */

// =============================================================================
// RE-EXPORTS BACKWARD-COMPAT (T-022 movio estas constantes al common)
// =============================================================================

export { AREAS_RELEVADAS_PRESETS } from '../common/areas';
export { normalizeCuit } from '../common/cuit';
export { PROVINCIAS_AR, provinciaName, type ProvinciaCode } from '../common/site';

// =============================================================================
// CONSTANTES ESPECIFICAS RGRL (no reusables forward)
// =============================================================================

export const DISTRIBUCION_TURNO = [
  { value: 'unico', label: 'Un turno (jornada continua)' },
  { value: 'doble', label: 'Dos turnos' },
  { value: 'triple', label: 'Tres turnos' },
  { value: 'continuo', label: 'Operación continua 24/7' },
  { value: 'rotativo', label: 'Rotativo / variable' },
] as const;
export type DistribucionTurno = (typeof DISTRIBUCION_TURNO)[number]['value'];
const DISTRIBUCION_TURNO_VALUES = ['unico', 'doble', 'triple', 'continuo', 'rotativo'] as const;

export const MODALIDAD_OPERATIVA = [
  { value: 'industrial', label: 'Industrial / manufactura' },
  { value: 'comercial', label: 'Comercial / venta' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'construccion', label: 'Construcción' },
  { value: 'agro', label: 'Agro / rural' },
  { value: 'logistica', label: 'Logística / depósito' },
  { value: 'mixto', label: 'Mixto' },
] as const;
export type ModalidadOperativa = (typeof MODALIDAD_OPERATIVA)[number]['value'];
const MODALIDAD_OPERATIVA_VALUES = [
  'industrial',
  'comercial',
  'servicios',
  'construccion',
  'agro',
  'logistica',
  'mixto',
] as const;

export const SERVICIO_HYS_MODALIDAD = [
  { value: 'interno', label: 'Interno (matriculado en relación de dependencia)' },
  { value: 'externo', label: 'Externo (consultoría)' },
  { value: 'mixto', label: 'Mixto' },
] as const;
export type ServicioHysModalidad = (typeof SERVICIO_HYS_MODALIDAD)[number]['value'];
const SERVICIO_HYS_MODALIDAD_VALUES = ['interno', 'externo', 'mixto'] as const;

// =============================================================================
// REGEX ESPECIFICOS RGRL
// =============================================================================

/** CIIU: 4 a 6 digitos (sin punto). 4 (CIIU original), 5 o 6 (revisiones AR). */
const CIIU_REGEX = /^\d{4,6}$/;

// =============================================================================
// SCHEMA PRINCIPAL
// =============================================================================
/**
 * 14 campos del form RGRL. Sigue el patron canonico del modulo:
 * - 5 campos comunes via `commonClientFieldsWithSite()`.
 * - 1 campo de fecha via `fechaIsoField`.
 * - 8 campos especificos RGRL.
 */
export const rgrlMetadataSchema = z.object({
  // — IDENTIFICACION + SITIO (commonClientFieldsWithSite) —
  ...commonClientFieldsWithSite(),

  // — ACTIVIDAD —
  actividad_principal: z
    .string()
    .trim()
    .min(3, { message: 'Mínimo 3 caracteres.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),

  /**
   * Opcional. Acepta '' (RHF default para inputs no completados) como
   * equivalente a undefined; el render helper y el action lo tratan como
   * ausente. Validacion del regex solo aplica si el string es no-vacio.
   */
  codigo_ciiu: z
    .string()
    .trim()
    .refine((v) => v === '' || CIIU_REGEX.test(v), {
      message: 'CIIU: 4 a 6 dígitos (sin punto).',
    })
    .optional(),

  // — OPERACION —
  /**
   * cantidad_empleados: `z.number()` (no coerce — rompe TFieldValues en RHF).
   * El input type === output type (number) requiere que el `<Input>` use cast
   * manual desde string. Cap 50.000: defensa contra typos.
   */
  cantidad_empleados: z
    .number({ message: 'Ingresá un número.' })
    .int({ message: 'Cantidad de empleados debe ser un número entero.' })
    .min(1, { message: 'Mínimo 1 empleado.' })
    .max(50000, { message: 'Máximo 50.000 empleados.' }),

  distribucion_turno: z.enum(DISTRIBUCION_TURNO_VALUES, {
    message: 'Elegí una distribución de turno.',
  }),

  modalidad_operativa: z.enum(MODALIDAD_OPERATIVA_VALUES, {
    message: 'Elegí una modalidad operativa.',
  }),

  // — COBERTURA Y SERVICIO HYS —
  art_contratada: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(100, { message: 'Máximo 100 caracteres.' }),

  servicio_hys_modalidad: z.enum(SERVICIO_HYS_MODALIDAD_VALUES, {
    message: 'Elegí la modalidad del servicio HyS.',
  }),

  // — RELEVAMIENTO —
  areas_relevadas: z
    .array(
      z
        .string()
        .trim()
        .min(1, { message: 'Área vacía no permitida.' })
        .max(80, { message: 'Cada área: máximo 80 caracteres.' }),
    )
    .min(1, { message: 'Marcá al menos un área relevada.' })
    .max(20, { message: 'Máximo 20 áreas.' }),

  /** Opcional. '' equivale a ausente (el render helper chequea truthy). */
  riesgos_pre_detectados: z
    .string()
    .trim()
    .max(2000, { message: 'Máximo 2000 caracteres.' })
    .optional(),

  fecha_relevamiento: fechaIsoField,

  // — PERSONALIZACION (T-138 fase 1, compartida por los 5 tipos) —
  // Aditiva: agrega datos/foco al user message; la estructura legal del RGRL
  // (10 secciones SRT) NO es configurable.
  campos_personalizados: camposPersonalizadosField(),
  instrucciones_adicionales: instruccionesAdicionalesField(),
});

export type RgrlMetadata = z.infer<typeof rgrlMetadataSchema>;

// =============================================================================
// NORMALIZADORES (compartidos entre form onBlur y server actions pre-persist)
// =============================================================================

/**
 * Limpia el payload RGRL pre-persist:
 * - CUIT normalizado a XX-XXXXXXXX-X.
 * - Strings opcionales vacios ('') → undefined (jsonb mas limpio).
 */
export function normalizeRgrlMetadata(m: RgrlMetadata): RgrlMetadata {
  return {
    ...m,
    cuit: normalizeCuit(m.cuit),
    codigo_ciiu: m.codigo_ciiu && m.codigo_ciiu.length > 0 ? m.codigo_ciiu : undefined,
    riesgos_pre_detectados:
      m.riesgos_pre_detectados && m.riesgos_pre_detectados.length > 0
        ? m.riesgos_pre_detectados
        : undefined,
    campos_personalizados: normalizeCamposPersonalizados(m.campos_personalizados),
    instrucciones_adicionales: normalizeInstruccionesAdicionales(m.instrucciones_adicionales),
  };
}

// =============================================================================
// LOOKUPS (para render + UI)
// =============================================================================
// `provinciaName` se re-exporta al tope desde common/site. Estos lookups
// son especificos RGRL (no aplican a otros tipos).

const DISTRIBUCION_TURNO_LABEL_BY_VALUE: Record<DistribucionTurno, string> = Object.fromEntries(
  DISTRIBUCION_TURNO.map((d) => [d.value, d.label]),
) as Record<DistribucionTurno, string>;

export function distribucionTurnoLabel(value: DistribucionTurno): string {
  return DISTRIBUCION_TURNO_LABEL_BY_VALUE[value];
}

const MODALIDAD_OPERATIVA_LABEL_BY_VALUE: Record<ModalidadOperativa, string> = Object.fromEntries(
  MODALIDAD_OPERATIVA.map((m) => [m.value, m.label]),
) as Record<ModalidadOperativa, string>;

export function modalidadOperativaLabel(value: ModalidadOperativa): string {
  return MODALIDAD_OPERATIVA_LABEL_BY_VALUE[value];
}

const SERVICIO_HYS_LABEL_BY_VALUE: Record<ServicioHysModalidad, string> = Object.fromEntries(
  SERVICIO_HYS_MODALIDAD.map((s) => [s.value, s.label]),
) as Record<ServicioHysModalidad, string>;

export function servicioHysModalidadLabel(value: ServicioHysModalidad): string {
  return SERVICIO_HYS_LABEL_BY_VALUE[value];
}
