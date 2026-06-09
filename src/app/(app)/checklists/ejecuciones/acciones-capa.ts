import type { ItemForScore, RespuestaForScore } from './scoring';

import { isNoCumple } from './scoring';

/**
 * T-060b · Lógica PURA de mapeo respuesta "no cumple" → acción correctiva (CAPA).
 *
 * Sin `'use server'`/`server-only`: la usan la Server Action de cierre y los unit
 * tests. Reglas (RFC T-060, owner): 1 CAPA por respuesta `cumple_no_aplica='no'`;
 * `prioridad` alta si el ítem es crítico; `fecha_compromiso` = la
 * `fecha_regularizacion` del hallazgo o, si falta, `cerrada_at + 30 días`.
 */

const DESC_MIN = 3; // CHECK acciones_correctivas.descripcion length 3..2000.
const DESC_MAX = 2000;
const DEFAULT_PLAZO_DIAS = 30;

export type RespuestaForCapa = RespuestaForScore & {
  id: string;
  template_item_id: string;
  observacion: string | null;
  fecha_regularizacion: string | null;
};

export type CapaRow = {
  respuesta_id: string;
  descripcion: string;
  prioridad: 'alta' | 'media';
  /** YYYY-MM-DD. */
  fecha_compromiso: string;
};

/** `cerrada_at` (ISO) + N días → fecha civil UTC (YYYY-MM-DD). Default plazo CAPA. */
export function defaultFechaCompromiso(
  cerradaAtIso: string,
  dias: number = DEFAULT_PLAZO_DIAS,
): string {
  const d = new Date(cerradaAtIso);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** descripcion = item.texto (+ " — " + observacion), clamp 3..2000 con guard si el texto base es <3. */
export function buildCapaDescripcion(itemTexto: string, observacion: string | null): string {
  const base = itemTexto.trim();
  let desc =
    observacion && observacion.trim().length > 0 ? `${base} — ${observacion.trim()}` : base;
  if (desc.length < DESC_MIN) desc = `Hallazgo: ${desc}`;
  return desc.slice(0, DESC_MAX);
}

/**
 * Mapea las respuestas "no cumple" a filas de CAPA (1 por respuesta). Las
 * respuestas sin ítem conocido o que no son "no cumple" se ignoran. Idempotente
 * a nivel de set (el INSERT usa ON CONFLICT (execution_id, respuesta_id)).
 */
export function buildCapaRows(
  items: ReadonlyArray<ItemForScore>,
  respuestas: ReadonlyArray<RespuestaForCapa>,
  cerradaAtIso: string,
): CapaRow[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const rows: CapaRow[] = [];
  for (const r of respuestas) {
    const item = itemById.get(r.template_item_id);
    if (!item) continue;
    if (!isNoCumple(item, r)) continue;
    rows.push({
      respuesta_id: r.id,
      descripcion: buildCapaDescripcion(item.texto, r.observacion),
      prioridad: item.es_critico ? 'alta' : 'media',
      fecha_compromiso: r.fecha_regularizacion ?? defaultFechaCompromiso(cerradaAtIso),
    });
  }
  return rows;
}
