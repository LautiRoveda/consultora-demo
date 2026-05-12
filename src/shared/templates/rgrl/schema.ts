import { z } from 'zod';

/**
 * T-021 · Schema + constantes del template RGRL (Relevamiento General de
 * Riesgos Laborales).
 *
 * NO `'use server'` — se importa desde Client Components (RHF + zodResolver)
 * y desde el render helper (server-side al armar el user message del Claude
 * API). Si fuera server, Next.js convierte los exports en RSC proxies y
 * zodResolver rompe.
 *
 * El payload jsonb de `informe_metadata.data` para tipo='rgrl' DEBE matchear
 * este schema. T-022 va a sumar schemas espejo para los otros 4 tipos.
 */

// =============================================================================
// CONSTANTES (espejo de option lists del UI form)
// =============================================================================

export const PROVINCIAS_AR = [
  { code: 'CABA', name: 'Ciudad Autónoma de Buenos Aires' },
  { code: 'BA', name: 'Buenos Aires' },
  { code: 'CT', name: 'Catamarca' },
  { code: 'CC', name: 'Chaco' },
  { code: 'CH', name: 'Chubut' },
  { code: 'CB', name: 'Córdoba' },
  { code: 'CN', name: 'Corrientes' },
  { code: 'ER', name: 'Entre Ríos' },
  { code: 'FM', name: 'Formosa' },
  { code: 'JY', name: 'Jujuy' },
  { code: 'LP', name: 'La Pampa' },
  { code: 'LR', name: 'La Rioja' },
  { code: 'MZ', name: 'Mendoza' },
  { code: 'MN', name: 'Misiones' },
  { code: 'NQ', name: 'Neuquén' },
  { code: 'RN', name: 'Río Negro' },
  { code: 'SA', name: 'Salta' },
  { code: 'SJ', name: 'San Juan' },
  { code: 'SL', name: 'San Luis' },
  { code: 'SC', name: 'Santa Cruz' },
  { code: 'SF', name: 'Santa Fe' },
  { code: 'SE', name: 'Santiago del Estero' },
  { code: 'TF', name: 'Tierra del Fuego' },
  { code: 'TM', name: 'Tucumán' },
] as const;

export type ProvinciaCode = (typeof PROVINCIAS_AR)[number]['code'];

const PROVINCIA_CODES = [
  'CABA',
  'BA',
  'CT',
  'CC',
  'CH',
  'CB',
  'CN',
  'ER',
  'FM',
  'JY',
  'LP',
  'LR',
  'MZ',
  'MN',
  'NQ',
  'RN',
  'SA',
  'SJ',
  'SL',
  'SC',
  'SF',
  'SE',
  'TF',
  'TM',
] as const satisfies readonly ProvinciaCode[];

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

/**
 * Presets de areas relevadas usados por el checkbox group del form.
 * Constante por separado para que T-022+ pueda extenderla sin tocar UI.
 */
export const AREAS_RELEVADAS_PRESETS = [
  'Oficinas administrativas',
  'Producción / planta',
  'Depósito / almacén',
  'Mantenimiento / taller',
  'Sala de máquinas',
  'Logística / expedición',
  'Áreas exteriores',
  'Servicios generales (comedor, sanitarios)',
] as const;

// =============================================================================
// REGEX
// =============================================================================

/** Acepta CUIT con o sin guiones. La transform normaliza a XX-XXXXXXXX-X. */
const CUIT_REGEX = /^\d{2}-?\d{8}-?\d{1}$/;

/** CIIU: 4 a 6 digitos (sin punto). 4 (CIIU original), 5 o 6 (revisiones AR). */
const CIIU_REGEX = /^\d{4,6}$/;

/** Fecha YYYY-MM-DD (formato nativo de <Input type="date">). */
const FECHA_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// =============================================================================
// SCHEMA PRINCIPAL
// =============================================================================
/**
 * 14 campos del form RGRL. Defensivamente sanitiza opcionales: si llega ''
 * desde el form (RHF default para inputs controlados), `z.preprocess` lo
 * convierte a undefined antes de validar el regex/length.
 */
export const rgrlMetadataSchema = z.object({
  // — IDENTIFICACION —
  razon_social: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(120, { message: 'Máximo 120 caracteres.' }),

  /**
   * CUIT: regex acepta con o sin guiones. La normalizacion a XX-XXXXXXXX-X
   * vive en `normalizeCuit()` (RgrlMetadataForm onBlur + actions pre-persist),
   * no en el schema — `z.transform()` rompe el match input/output que RHF
   * necesita para inferir TFieldValues correctamente.
   * NOTA: NO validamos digito verificador (modulo 11). Deuda forward T-029.
   */
  cuit: z
    .string()
    .trim()
    .regex(CUIT_REGEX, { message: 'Formato CUIT: XX-XXXXXXXX-X (con o sin guiones).' }),

  domicilio: z
    .string()
    .trim()
    .min(3, { message: 'Mínimo 3 caracteres.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),

  localidad: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(80, { message: 'Máximo 80 caracteres.' }),

  provincia: z.enum(PROVINCIA_CODES, { message: 'Elegí una provincia.' }),

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
   * cantidad_empleados: `z.number()` (no coerce — coerce cambia input type a
   * `unknown` y rompe TFieldValues en RHF). El input type === output type
   * (number) requiere que el `<Input>` use `valueAsNumber: true` para cast.
   * Cap 50.000: defensa contra typos. PYMEs AR raramente > 5.000.
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

  /**
   * Opcional. '' equivale a ausente (el render helper chequea truthy).
   */
  riesgos_pre_detectados: z
    .string()
    .trim()
    .max(2000, { message: 'Máximo 2000 caracteres.' })
    .optional(),

  fecha_relevamiento: z
    .string()
    .regex(FECHA_ISO_REGEX, { message: 'Formato YYYY-MM-DD.' })
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Fecha inválida.' }),
});

export type RgrlMetadata = z.infer<typeof rgrlMetadataSchema>;

// =============================================================================
// NORMALIZADORES (compartidos entre form onBlur y server actions pre-persist)
// =============================================================================

/**
 * CUIT con o sin guiones → XX-XXXXXXXX-X. Si no tiene 11 digitos, devuelve
 * el input original sin cambios (el regex del schema lo rechaza al validar).
 */
export function normalizeCuit(raw: string): string {
  const digits = raw.replace(/-/g, '').trim();
  if (!/^\d{11}$/.test(digits)) return raw;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10, 11)}`;
}

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
  };
}

// =============================================================================
// LOOKUPS (para render + UI)
// =============================================================================

const PROVINCIA_NAME_BY_CODE: Record<ProvinciaCode, string> = Object.fromEntries(
  PROVINCIAS_AR.map((p) => [p.code, p.name]),
) as Record<ProvinciaCode, string>;

export function provinciaName(code: ProvinciaCode): string {
  return PROVINCIA_NAME_BY_CODE[code];
}

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
