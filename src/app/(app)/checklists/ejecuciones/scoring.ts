/**
 * T-060a · Lógica PURA de scoring + completitud + detección de "no cumple".
 *
 * Sin `'use server'` ni `server-only`: la importan la Server Action de cierre Y
 * los unit tests (node) sin tocar DB. La fuente de verdad de las reglas (RFC
 * T-060, owner-aprobado):
 *  - Solo `response_type='cumple_no_aplica'` cuenta para el score y genera CAPA.
 *    `si_no`/`texto`/`numerico` son informativos.
 *  - score = cumple / (cumple + no_cumple); N-A excluido del denominador.
 *  - `tiene_criticos_incumplidos` = algún ítem `es_critico` con valor='no'.
 *  - Cierre BLOQUEA si hay ítems `es_requerido` sin responder (EXEC_INCOMPLETE).
 */

export const CUMPLE_NO_APLICA = 'cumple_no_aplica' as const;
export const SI_NO = 'si_no' as const;
export const TEXTO = 'texto' as const;
export const NUMERICO = 'numerico' as const;

/** Valores canónicos de `cumple_no_aplica` (espeja el comment del schema T-057). */
export const VALOR_CUMPLE = 'si' as const;
export const VALOR_NO_CUMPLE = 'no' as const;
export const VALOR_NO_APLICA = 'na' as const;

export type ItemForScore = {
  id: string;
  response_type: string;
  es_critico: boolean;
  es_requerido: boolean;
  texto: string;
};

export type RespuestaForScore = {
  valor: string | null;
  valor_numerico: number | null;
};

export type ScoreResult = {
  score_cumple: number;
  score_no_cumple: number;
  score_na: number;
  /** cumple/(cumple+no_cumple) en %, redondeado a 2 decimales. NULL si denom 0. */
  cumplimiento_pct: number | null;
  tiene_criticos_incumplidos: boolean;
};

export type UnansweredItem = { id: string; texto: string };

/** Indexa respuestas por `template_item_id` para lookups O(1) en el cierre. */
export function respuestasByItem(
  respuestas: ReadonlyArray<RespuestaForScore & { template_item_id: string }>,
): Map<string, RespuestaForScore> {
  const map = new Map<string, RespuestaForScore>();
  for (const r of respuestas)
    map.set(r.template_item_id, { valor: r.valor, valor_numerico: r.valor_numerico });
  return map;
}

/** ¿La respuesta cuenta como "respondida" según el tipo del ítem? */
export function isAnswered(item: ItemForScore, resp: RespuestaForScore | undefined): boolean {
  if (!resp) return false;
  switch (item.response_type) {
    case CUMPLE_NO_APLICA:
    case SI_NO:
      return resp.valor != null && resp.valor.trim().length > 0;
    case TEXTO:
      return resp.valor != null && resp.valor.trim().length > 0;
    case NUMERICO:
      return resp.valor_numerico != null;
    default:
      return false;
  }
}

/** ¿Es un "no cumple" que genera CAPA? Solo `cumple_no_aplica` con valor='no'. */
export function isNoCumple(item: ItemForScore, resp: RespuestaForScore | undefined): boolean {
  return item.response_type === CUMPLE_NO_APLICA && resp?.valor === VALOR_NO_CUMPLE;
}

/** Ítems `es_requerido` sin responder. El cierre bloquea (EXEC_INCOMPLETE) si no vacío. */
export function findUnansweredRequired(
  items: ReadonlyArray<ItemForScore>,
  byItem: Map<string, RespuestaForScore>,
): UnansweredItem[] {
  const missing: UnansweredItem[] = [];
  for (const item of items) {
    if (!item.es_requerido) continue;
    if (!isAnswered(item, byItem.get(item.id))) missing.push({ id: item.id, texto: item.texto });
  }
  return missing;
}

/** Score congelado al cierre. Solo `cumple_no_aplica`; N-A fuera del denominador. */
export function computeScore(
  items: ReadonlyArray<ItemForScore>,
  byItem: Map<string, RespuestaForScore>,
): ScoreResult {
  let cumple = 0;
  let noCumple = 0;
  let na = 0;
  let criticoIncumplido = false;

  for (const item of items) {
    if (item.response_type !== CUMPLE_NO_APLICA) continue;
    const valor = byItem.get(item.id)?.valor;
    if (valor === VALOR_CUMPLE) cumple += 1;
    else if (valor === VALOR_NO_CUMPLE) {
      noCumple += 1;
      if (item.es_critico) criticoIncumplido = true;
    } else if (valor === VALOR_NO_APLICA) na += 1;
  }

  const denom = cumple + noCumple;
  const cumplimiento_pct = denom > 0 ? Math.round((cumple / denom) * 10000) / 100 : null;

  return {
    score_cumple: cumple,
    score_no_cumple: noCumple,
    score_na: na,
    cumplimiento_pct,
    tiene_criticos_incumplidos: criticoIncumplido,
  };
}
