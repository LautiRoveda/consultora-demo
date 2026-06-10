import type { InformeTipo } from '@/app/(app)/informes/schema';
import type { ZodType } from 'zod';
import type { CampoPersonalizado } from '../common/campos-extra';
import type { SeccionConfig } from '../common/secciones';
import { z } from 'zod';

import { SECCION_IDS_CAPACITACION } from '../capacitacion/secciones';
import {
  campoPersonalizadoSchema,
  CAMPOS_PERSONALIZADOS_MAX,
  camposPersonalizadosField,
  INSTRUCCIONES_ADICIONALES_MAX,
  instruccionesAdicionalesField,
  normalizeCamposPersonalizados,
  normalizeInstruccionesAdicionales,
} from '../common/campos-extra';
import {
  normalizeSecciones,
  seccionCustomSchema,
  SECCIONES_MAX_CUSTOM,
  SECCIONES_MAX_TOTAL,
  seccionesField,
} from '../common/secciones';
import { SECCION_IDS_OTROS } from '../otros/secciones';
import { SECCION_IDS_RELEVAMIENTO } from '../relevamiento/secciones';

/**
 * T-139 · Schema de la config de `informe_plantillas.config` (jsonb) por tipo.
 *
 * La config de una plantilla es el SUBSET de personalizacion de los
 * `<tipo>MetadataSchema` de fases 1+2 — los mismos factories, los mismos caps,
 * el mismo catalogo de secciones. Cero validacion nueva: una config que pasa
 * aca es exactamente lo que el metadata schema del tipo acepta al aplicar.
 *
 * `.strict()` y no `.strip()`: la config es ESTRUCTURA, nunca datos del
 * cliente. Un payload con `razon_social`/`cuit`/etc. (campos por-informe) es
 * bug o abuso → se rechaza fuerte, no se limpia en silencio. Tambien rechaza
 * `secciones` en rgrl/accidente (estructura legal fija, sin esa key).
 *
 * Vive en registry/ (no en common/) porque cruza common + catalogos per-tipo,
 * misma direccion de deps que `server.ts`. NO `'use server'` ni `'use client'`:
 * se importa desde actions (validar al guardar) y desde el cliente (degradar
 * al aplicar).
 */

export type PlantillaConfig = {
  campos_personalizados?: CampoPersonalizado[];
  instrucciones_adicionales?: string;
  secciones?: SeccionConfig[];
};

const base = {
  campos_personalizados: camposPersonalizadosField(),
  instrucciones_adicionales: instruccionesAdicionalesField(),
};

export const PLANTILLA_CONFIG_SCHEMA_BY_TIPO: Record<InformeTipo, ZodType> = {
  relevamiento: z.object({ ...base, secciones: seccionesField(SECCION_IDS_RELEVAMIENTO) }).strict(),
  capacitacion: z.object({ ...base, secciones: seccionesField(SECCION_IDS_CAPACITACION) }).strict(),
  otros: z.object({ ...base, secciones: seccionesField(SECCION_IDS_OTROS) }).strict(),
  // Estructura legal fija: plantilla solo con campos + instrucciones.
  rgrl: z.object(base).strict(),
  accidente: z.object(base).strict(),
};

/**
 * Catalogo de ids por tipo para normalize/degrade. `null` = tipo sin
 * secciones configurables. Espejo del registry de schemas de arriba.
 */
export const PLANTILLA_SECCION_IDS_BY_TIPO: Record<InformeTipo, readonly string[] | null> = {
  relevamiento: SECCION_IDS_RELEVAMIENTO,
  capacitacion: SECCION_IDS_CAPACITACION,
  otros: SECCION_IDS_OTROS,
  rgrl: null,
  accidente: null,
};

/**
 * Pre-persist: reusa los normalizadores de fases 1+2 ('' / [] / seleccion
 * default de secciones → undefined; JSON.stringify dropea las keys → jsonb
 * lean). Idempotente. PRECONDICION: config ya parseada por el schema del tipo.
 */
export function normalizePlantillaConfig(
  tipo: InformeTipo,
  config: PlantillaConfig,
): PlantillaConfig {
  const ids = PLANTILLA_SECCION_IDS_BY_TIPO[tipo];
  return {
    campos_personalizados: normalizeCamposPersonalizados(config.campos_personalizados),
    instrucciones_adicionales: normalizeInstruccionesAdicionales(config.instrucciones_adicionales),
    secciones: ids ? normalizeSecciones(config.secciones, ids) : undefined,
  };
}

/**
 * True si la config no personaliza nada. Chequear POST-normalize: una config
 * "solo secciones en default" pasa el schema pero normaliza a vacia — guardar
 * esa plantilla no tiene sentido (aplicarla es un no-op).
 */
export function isPlantillaConfigVacia(config: PlantillaConfig): boolean {
  return (
    (config.campos_personalizados?.length ?? 0) === 0 &&
    !config.instrucciones_adicionales &&
    (config.secciones?.length ?? 0) === 0
  );
}

export type DegradePlantillaResult =
  | { ok: true; config: PlantillaConfig; degradado: boolean }
  | { ok: false };

/**
 * Re-validacion al APLICAR una plantilla (snapshot-on-apply). Una plantilla
 * vieja puede referenciar secciones que ya no existen en el catalogo del tipo
 * o exceder caps que se achicaron: degradar (filtrar lo invalido, recortar a
 * caps), no romper.
 *
 * 1. Parse directo → config intacta (`degradado: false`).
 * 2. Salvage: pick de las 3 keys conocidas, filtra entradas invalidas de
 *    `secciones` (refs fuera del catalogo, duplicadas, customs malformadas),
 *    recorta a caps, re-parsea.
 * 3. Si lo salvado sigue invalido o quedo vacio → `{ ok: false }` (la UI
 *    avisa "plantilla incompatible"; nunca tira).
 *
 * Pura y sin directiva: corre client-side al aplicar. La defensa server queda
 * intacta igual — lo aplicado se persiste por el flujo existente de informes,
 * que re-valida contra `<tipo>MetadataSchema`.
 */
export function degradePlantillaConfig(tipo: InformeTipo, raw: unknown): DegradePlantillaResult {
  const schema = PLANTILLA_CONFIG_SCHEMA_BY_TIPO[tipo];
  const direct = schema.safeParse(raw);
  if (direct.success) {
    const config = normalizePlantillaConfig(tipo, direct.data as PlantillaConfig);
    return isPlantillaConfigVacia(config) ? { ok: false } : { ok: true, config, degradado: false };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false };
  const r = raw as Record<string, unknown>;
  const salvaged: Record<string, unknown> = {};

  if (Array.isArray(r.campos_personalizados)) {
    const campos = r.campos_personalizados
      .filter((c) => campoPersonalizadoSchema.safeParse(c).success)
      .slice(0, CAMPOS_PERSONALIZADOS_MAX);
    if (campos.length > 0) salvaged.campos_personalizados = campos;
  }

  if (typeof r.instrucciones_adicionales === 'string') {
    const instrucciones = r.instrucciones_adicionales
      .trim()
      .slice(0, INSTRUCCIONES_ADICIONALES_MAX);
    if (instrucciones.length > 0) salvaged.instrucciones_adicionales = instrucciones;
  }

  const ids = PLANTILLA_SECCION_IDS_BY_TIPO[tipo];
  if (ids && Array.isArray(r.secciones)) {
    const vistos = new Set<string>();
    let customs = 0;
    const kept: unknown[] = [];
    for (const s of r.secciones) {
      if (kept.length >= SECCIONES_MAX_TOTAL) break;
      if (typeof s !== 'object' || s === null) continue;
      const entry = s as { kind?: unknown; seccion_id?: unknown };
      if (entry.kind === 'catalogo') {
        const id = entry.seccion_id;
        if (typeof id === 'string' && ids.includes(id) && !vistos.has(id)) {
          vistos.add(id);
          kept.push({ kind: 'catalogo', seccion_id: id });
        }
      } else if (entry.kind === 'custom' && customs < SECCIONES_MAX_CUSTOM) {
        const parsed = seccionCustomSchema.safeParse(entry);
        if (parsed.success) {
          customs += 1;
          kept.push(parsed.data);
        }
      }
    }
    if (kept.length > 0) salvaged.secciones = kept;
  }

  const reparsed = schema.safeParse(salvaged);
  if (!reparsed.success) return { ok: false };
  const config = normalizePlantillaConfig(tipo, reparsed.data as PlantillaConfig);
  if (isPlantillaConfigVacia(config)) return { ok: false };
  return { ok: true, config, degradado: true };
}
