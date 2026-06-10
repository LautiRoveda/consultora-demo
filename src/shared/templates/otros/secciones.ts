import type { SeccionCatalogoItem } from '../common/secciones';

/**
 * T-138 fase 2 · Catalogo de secciones del informe generico ("otros").
 *
 * Client-safe: SOLO id + label. Cuerpos en `ai/prompts/otros.ts` (Record
 * exhaustivo por id — anti-drift por compilacion). Labels EXACTOS a los
 * headings del prompt pre-fase-2 (canary byte a byte).
 */

export const SECCIONES_OTROS = [
  { id: 'objeto', label: 'Objeto del informe' },
  { id: 'alcance', label: 'Alcance' },
  { id: 'datos_cliente', label: 'Datos del establecimiento / cliente' },
  { id: 'marco_normativo', label: 'Marco normativo aplicable' },
  { id: 'desarrollo', label: 'Desarrollo' },
  { id: 'conclusiones', label: 'Conclusiones' },
  { id: 'recomendaciones', label: 'Recomendaciones' },
  { id: 'anexos', label: 'Anexos' },
] as const satisfies readonly SeccionCatalogoItem[];

export type SeccionOtrosId = (typeof SECCIONES_OTROS)[number]['id'];

export const SECCION_IDS_OTROS = [
  'objeto',
  'alcance',
  'datos_cliente',
  'marco_normativo',
  'desarrollo',
  'conclusiones',
  'recomendaciones',
  'anexos',
] as const satisfies readonly SeccionOtrosId[];

export const SECCION_LABEL_BY_ID_OTROS: Record<SeccionOtrosId, string> = Object.fromEntries(
  SECCIONES_OTROS.map((s) => [s.id, s.label]),
) as Record<SeccionOtrosId, string>;
