import type { InformeTipo } from '@/app/(app)/informes/schema';
import type { ZodType } from 'zod';

import { renderAccidenteMetadataAsPromptContext } from '../accidente/render';
import { accidenteMetadataSchema, normalizeAccidenteMetadata } from '../accidente/schema';
import { renderCapacitacionMetadataAsPromptContext } from '../capacitacion/render';
import { capacitacionMetadataSchema, normalizeCapacitacionMetadata } from '../capacitacion/schema';
import { renderOtrosMetadataAsPromptContext } from '../otros/render';
import { normalizeOtrosMetadata, otrosMetadataSchema } from '../otros/schema';
import { renderRelevamientoMetadataAsPromptContext } from '../relevamiento/render';
import { normalizeRelevamientoMetadata, relevamientoMetadataSchema } from '../relevamiento/schema';
import { renderRgrlMetadataAsPromptContext } from '../rgrl/render';
import { normalizeRgrlMetadata, rgrlMetadataSchema } from '../rgrl/schema';

/**
 * T-022 · Registry server-side de templates por tipo de informe.
 *
 * Provee schema + render + normalize por tipo. Importable desde Server Actions,
 * Server Components y tests (sin arrastrar Client Components al graph).
 *
 * El registry cliente (`./client.tsx`, PARADA #3) vive aparte y expone los
 * Form/Summary components — boundary clara para que el bundle del action no
 * traiga JSX.
 *
 * El record es exhaustivo sobre `InformeTipo`: agregar un tipo nuevo a
 * `INFORME_TIPOS` falla TS aca hasta que se sume su entry.
 *
 * Type-safety: las firmas internas de cada `render`/`normalize` son
 * type-narrowed a su `z.infer` concreto. En el registry, las almacenamos como
 * `(data: unknown) => ...` — el consumer SIEMPRE debe `entry.schema.safeParse`
 * primero y pasarle `parsed.data` al callable. Discriminated union completa
 * seria over-engineering por 5 tipos.
 */

export type TemplateServerEntry = {
  /** Schema Zod que valida el shape de `informe_metadata.data` para este tipo. */
  schema: ZodType;
  /**
   * Renderiza la metadata como bloque markdown para inyectar al user message
   * del Claude API call. Footer de re-anclaje incluido.
   *
   * PRECONDICION: `data` debe haber pasado `schema.safeParse` exitoso. Pasar
   * data sin parsear es UB (los lookups asumen shape valido).
   */
  render: (data: unknown) => string;
  /**
   * Limpia el payload pre-persist: CUIT a canonical, '' → undefined.
   * Idempotente. Misma precondicion que `render`.
   */
  normalize: (data: unknown) => unknown;
};

/**
 * Helper interno: wrapea un render/normalize tipado a (unknown) => X. Las
 * firmas concretas ya son verificadas por TS al referenciar los imports —
 * este cast solo borra el `z.infer` que el registry no expresa.
 */
const wrap = <T>(fn: (d: T) => string): ((d: unknown) => string) => fn as (d: unknown) => string;
const wrapNorm = <T>(fn: (d: T) => T): ((d: unknown) => unknown) => fn as (d: unknown) => unknown;

/**
 * Registry exhaustivo. Si un tipo no tiene template (futuro), el valor es
 * `null` — el consumer debe handlear el caso. Por T-022 los 5 tipos lo tienen.
 */
export const TEMPLATE_SERVER_REGISTRY: Record<InformeTipo, TemplateServerEntry | null> = {
  rgrl: {
    schema: rgrlMetadataSchema,
    render: wrap(renderRgrlMetadataAsPromptContext),
    normalize: wrapNorm(normalizeRgrlMetadata),
  },
  capacitacion: {
    schema: capacitacionMetadataSchema,
    render: wrap(renderCapacitacionMetadataAsPromptContext),
    normalize: wrapNorm(normalizeCapacitacionMetadata),
  },
  relevamiento: {
    schema: relevamientoMetadataSchema,
    render: wrap(renderRelevamientoMetadataAsPromptContext),
    normalize: wrapNorm(normalizeRelevamientoMetadata),
  },
  accidente: {
    schema: accidenteMetadataSchema,
    render: wrap(renderAccidenteMetadataAsPromptContext),
    normalize: wrapNorm(normalizeAccidenteMetadata),
  },
  otros: {
    schema: otrosMetadataSchema,
    render: wrap(renderOtrosMetadataAsPromptContext),
    normalize: wrapNorm(normalizeOtrosMetadata),
  },
};

/**
 * Helper de acceso: retorna la entry para un tipo si la tiene, sino null.
 * Los consumers usan el resultado para narrowing:
 *
 *   const entry = getServerTemplate(informe.tipo);
 *   if (entry) {
 *     const parsed = entry.schema.safeParse(row.data);
 *     if (parsed.success) promptContext = entry.render(parsed.data);
 *   }
 */
export function getServerTemplate(tipo: InformeTipo): TemplateServerEntry | null {
  return TEMPLATE_SERVER_REGISTRY[tipo];
}
