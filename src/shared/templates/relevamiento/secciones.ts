import type { SeccionCatalogoItem } from '../common/secciones';

/**
 * T-138 fase 2 · Catalogo de secciones del informe de relevamiento tecnico.
 *
 * Client-safe: SOLO id + label. Cuerpos en `ai/prompts/relevamiento.ts`
 * (Record exhaustivo por id — anti-drift por compilacion). Labels EXACTOS a
 * los headings del prompt pre-fase-2 (canary byte a byte).
 */

export const SECCIONES_RELEVAMIENTO = [
  { id: 'datos_establecimiento', label: 'Datos del establecimiento' },
  { id: 'alcance', label: 'Alcance del relevamiento' },
  { id: 'metodologia', label: 'Metodología' },
  { id: 'mediciones', label: 'Mediciones realizadas' },
  { id: 'conclusiones', label: 'Conclusiones por puesto / área' },
  { id: 'recomendaciones', label: 'Recomendaciones' },
  { id: 'anexos', label: 'Anexos' },
] as const satisfies readonly SeccionCatalogoItem[];

export type SeccionRelevamientoId = (typeof SECCIONES_RELEVAMIENTO)[number]['id'];

export const SECCION_IDS_RELEVAMIENTO = [
  'datos_establecimiento',
  'alcance',
  'metodologia',
  'mediciones',
  'conclusiones',
  'recomendaciones',
  'anexos',
] as const satisfies readonly SeccionRelevamientoId[];

export const SECCION_LABEL_BY_ID_RELEVAMIENTO: Record<SeccionRelevamientoId, string> =
  Object.fromEntries(SECCIONES_RELEVAMIENTO.map((s) => [s.id, s.label])) as Record<
    SeccionRelevamientoId,
    string
  >;
