import { z } from 'zod';

import { normalizeCuit } from '../common/cuit';
import { commonClientFieldsWithSite, fechaIsoField } from '../common/schema';

/**
 * T-022 · Schema del template Relevamiento técnico general.
 *
 * DISTINTO del RGRL: el RGRL es el formulario anual SRT obligatorio con datos
 * del establecimiento; "relevamiento" general es un informe técnico de
 * mediciones de agentes especificos (ruido, iluminacion, carga termica, etc.).
 *
 * 8 campos. Estructura:
 * - 5 campos de identificacion + sitio (commonClientFieldsWithSite).
 * - 3 campos especificos del alcance del relevamiento.
 *
 * AREAS_RELEVADAS_PRESETS se reusan del common — ambos tipos relevan en las
 * mismas areas fisicas.
 */

// =============================================================================
// CONSTANTES
// =============================================================================

/**
 * Agentes HyS clasicos relevables. Lista cerrada — el LLM puede sugerir
 * umbrales SRT por agente (Decreto 351/79 Anexo V, Res. 295/03 ruido,
 * Res. 295/03 iluminacion, Res. 295/03 carga termica WBGT, etc.).
 */
export const AGENTES_HYS = [
  { value: 'ruido', label: 'Ruido' },
  { value: 'iluminacion', label: 'Iluminación' },
  { value: 'carga_termica', label: 'Carga térmica (WBGT)' },
  { value: 'vibraciones', label: 'Vibraciones' },
  { value: 'ergonomia', label: 'Ergonomía' },
  { value: 'agentes_quimicos', label: 'Agentes químicos' },
  { value: 'agentes_biologicos', label: 'Agentes biológicos' },
  { value: 'radiaciones', label: 'Radiaciones' },
  { value: 'polvo', label: 'Polvo y particulado' },
  { value: 'gases_vapores', label: 'Gases y vapores' },
] as const;
export type AgenteHys = (typeof AGENTES_HYS)[number]['value'];
const AGENTES_VALUES = [
  'ruido',
  'iluminacion',
  'carga_termica',
  'vibraciones',
  'ergonomia',
  'agentes_quimicos',
  'agentes_biologicos',
  'radiaciones',
  'polvo',
  'gases_vapores',
] as const;

// =============================================================================
// SCHEMA PRINCIPAL
// =============================================================================

export const relevamientoMetadataSchema = z.object({
  // — IDENTIFICACION + SITIO —
  ...commonClientFieldsWithSite(),

  // — ALCANCE —
  fecha_relevamiento: fechaIsoField,

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

  agentes_a_relevar: z
    .array(z.enum(AGENTES_VALUES))
    .min(1, { message: 'Marcá al menos un agente a relevar.' })
    .max(10, { message: 'Máximo 10 agentes.' }),

  /** Opcional. Listado libre de equipos disponibles. */
  equipos_medicion: z.string().trim().max(2000, { message: 'Máximo 2000 caracteres.' }).optional(),
});

export type RelevamientoMetadata = z.infer<typeof relevamientoMetadataSchema>;

// =============================================================================
// NORMALIZADOR
// =============================================================================

export function normalizeRelevamientoMetadata(m: RelevamientoMetadata): RelevamientoMetadata {
  return {
    ...m,
    cuit: normalizeCuit(m.cuit),
    equipos_medicion:
      m.equipos_medicion && m.equipos_medicion.length > 0 ? m.equipos_medicion : undefined,
  };
}

// =============================================================================
// LOOKUPS
// =============================================================================

const AGENTE_LABEL_BY_VALUE: Record<AgenteHys, string> = Object.fromEntries(
  AGENTES_HYS.map((a) => [a.value, a.label]),
) as Record<AgenteHys, string>;

export function agenteHysLabel(value: AgenteHys): string {
  return AGENTE_LABEL_BY_VALUE[value];
}
