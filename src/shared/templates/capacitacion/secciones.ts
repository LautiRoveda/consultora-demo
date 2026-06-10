import type { SeccionCatalogoItem } from '../common/secciones';

/**
 * T-138 fase 2 · Catalogo de secciones del informe de capacitacion.
 *
 * Client-safe: SOLO id + label (la UI de seleccion los muestra). Los cuerpos
 * markdown viven en `ai/prompts/capacitacion.ts` como Record exhaustivo por
 * id — agregar un id aca sin cuerpo alla es error de compilacion (anti-drift).
 *
 * Labels EXACTOS a los headings del prompt pre-fase-2 (el canary
 * prompts-secciones-assembly lo ancla byte a byte).
 */

export const SECCIONES_CAPACITACION = [
  { id: 'datos_generales', label: 'Datos generales de la capacitación' },
  { id: 'marco_normativo', label: 'Marco normativo' },
  { id: 'audiencia_objetivo', label: 'Audiencia objetivo' },
  { id: 'contenidos', label: 'Contenidos dictados' },
  { id: 'metodologia', label: 'Metodología' },
  { id: 'evaluacion', label: 'Evaluación' },
  { id: 'material', label: 'Material entregado' },
  { id: 'conclusiones', label: 'Conclusiones y observaciones' },
  { id: 'anexos', label: 'Anexos' },
] as const satisfies readonly SeccionCatalogoItem[];

export type SeccionCapacitacionId = (typeof SECCIONES_CAPACITACION)[number]['id'];

export const SECCION_IDS_CAPACITACION = [
  'datos_generales',
  'marco_normativo',
  'audiencia_objetivo',
  'contenidos',
  'metodologia',
  'evaluacion',
  'material',
  'conclusiones',
  'anexos',
] as const satisfies readonly SeccionCapacitacionId[];

export const SECCION_LABEL_BY_ID_CAPACITACION: Record<SeccionCapacitacionId, string> =
  Object.fromEntries(SECCIONES_CAPACITACION.map((s) => [s.id, s.label])) as Record<
    SeccionCapacitacionId,
    string
  >;
