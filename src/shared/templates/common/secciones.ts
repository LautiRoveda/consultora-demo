import { z } from 'zod';

/**
 * T-138 fase 2 · Configuracion de secciones del informe (tipos SIN estructura
 * legal: relevamiento / capacitacion / otros — rgrl y accidente quedan fijos).
 *
 * El catalogo de cada tipo vive en `templates/{tipo}/secciones.ts` como datos
 * client-safe ({id, label}); los CUERPOS markdown de cada seccion quedan
 * server-side en `ai/prompts/{tipo}.ts` (peso + IP de prompts fuera del
 * bundle del cliente). El system prompt se re-arma en module-load desde el
 * catalogo (string estatico → prompt caching intacto) y la SELECCION del
 * usuario viaja en el user message ("Estructura solicitada").
 *
 * `secciones` es `.optional()`: metadata pre-fase-2 parsea sin cambios y
 * `normalizeSecciones` dropea la config igual al default — un informe sin
 * config se comporta byte-identico a hoy.
 *
 * IMPORTANT: NO `'use server'` ni `'use client'`. Sin coerce/preprocess/
 * transform (07-zod-rhf-gotchas). El discriminador es `kind` y la ref usa
 * `seccion_id` (NO `id`): useFieldArray inyecta su key interna como `id` en
 * `fields[]` y shadowearia el dato.
 */

export const SECCIONES_MAX_TOTAL = 15; // catalogo max 9 (capacitacion) + 5 customs + margen
export const SECCIONES_MAX_CUSTOM = 5;
export const SECCION_TITULO_MIN = 3;
export const SECCION_TITULO_MAX = 80;
export const SECCION_DESCRIPCION_MAX = 300;

/** Item del catalogo client-safe. El cuerpo markdown vive en ai/prompts. */
export type SeccionCatalogoItem<Id extends string = string> = { id: Id; label: string };

export const seccionCustomSchema = z.object({
  kind: z.literal('custom'),
  titulo: z
    .string()
    .trim()
    .min(SECCION_TITULO_MIN, { message: `Mínimo ${SECCION_TITULO_MIN} caracteres.` })
    .max(SECCION_TITULO_MAX, { message: `Máximo ${SECCION_TITULO_MAX} caracteres.` }),
  /** Opcional. Acepta '' desde RHF; normalize la dropea. */
  descripcion: z
    .string()
    .trim()
    .max(SECCION_DESCRIPCION_MAX, { message: `Máximo ${SECCION_DESCRIPCION_MAX} caracteres.` })
    .optional(),
});

/**
 * Factory del campo `secciones` — cada tipo fase-2 la invoca con el tuple de
 * ids de su catalogo. Array ordenado: el orden ES la configuracion.
 */
export const seccionesField = <const T extends readonly [string, ...string[]]>(ids: T) =>
  z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('catalogo'), seccion_id: z.enum(ids) }),
        seccionCustomSchema,
      ]),
    )
    .min(1, { message: 'Dejá al menos una sección.' })
    .max(SECCIONES_MAX_TOTAL, { message: `Máximo ${SECCIONES_MAX_TOTAL} secciones.` })
    .refine(
      (s) => {
        const refs = s.filter((x) => x.kind === 'catalogo').map((x) => x.seccion_id);
        return new Set(refs).size === refs.length;
      },
      { message: 'Hay secciones del catálogo repetidas.' },
    )
    .refine((s) => s.filter((x) => x.kind === 'custom').length <= SECCIONES_MAX_CUSTOM, {
      message: `Máximo ${SECCIONES_MAX_CUSTOM} secciones personalizadas.`,
    })
    .optional();

export type SeccionConfig<Id extends string = string> =
  | { kind: 'catalogo'; seccion_id: Id }
  | { kind: 'custom'; titulo: string; descripcion?: string };

/** Default = catalogo completo en orden canonico (lo que el prompt genera hoy). */
export function defaultSeccionesConfig<Id extends string>(ids: readonly Id[]): SeccionConfig<Id>[] {
  return ids.map((id) => ({ kind: 'catalogo', seccion_id: id }));
}

/**
 * Compara contra el default. Shallow y O(n): el default es 100% refs de
 * catalogo en orden canonico, no hace falta deep-equal.
 */
export function esSeleccionDefault(
  secciones: readonly SeccionConfig[],
  defaultIds: readonly string[],
): boolean {
  return (
    secciones.length === defaultIds.length &&
    secciones.every((s, i) => s.kind === 'catalogo' && s.seccion_id === defaultIds[i])
  );
}

/**
 * Pre-persist: undefined si vacio o igual al default (jsonb lean + el render
 * no emite bloque → informe "en default" byte-identico a pre-fase-2); en
 * customs, descripcion '' → undefined. Idempotente.
 */
export function normalizeSecciones<Id extends string>(
  secciones: SeccionConfig<Id>[] | undefined,
  defaultIds: readonly Id[],
): SeccionConfig<Id>[] | undefined {
  if (!secciones || secciones.length === 0) return undefined;
  if (esSeleccionDefault(secciones, defaultIds)) return undefined;
  return secciones.map((s) =>
    s.kind === 'custom'
      ? { ...s, descripcion: s.descripcion && s.descripcion.length > 0 ? s.descripcion : undefined }
      : s,
  );
}
