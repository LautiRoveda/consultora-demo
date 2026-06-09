import { createHash } from 'node:crypto';

/**
 * T-060a · `firma_pdf_hash` = sha256 de un snapshot CANÓNICO de los datos de la
 * inspección al cerrar (NO de los bytes del PDF).
 *
 * Decisión RFC T-060 (owner): el PDF se genera on-demand (Puppeteer NO es
 * determinístico → hashear sus bytes no sería reproducible). En cambio hasheamos
 * un JSON canónico de las respuestas + la metadata de cierre → tamper-evidence de
 * los DATOS congelados, verificable recomputando el mismo JSON. El route PDF
 * (T-060b) puede re-derivar este hash para verificar integridad.
 *
 * CANONICIDAD: orden de claves FIJO (insertion order de JSON.stringify) +
 * respuestas ordenadas por `template_item_id` + `??null` explícito para que
 * `undefined` y campos faltantes colapsen al mismo valor. Sin esto el hash no es
 * reproducible. La columna SQL valida `^[0-9a-f]{64}$` (sha256 hex lower).
 */

export type CanonicalRespuesta = {
  template_item_id: string;
  valor: string | null;
  valor_numerico: number | null;
  observacion: string | null;
  fecha_regularizacion: string | null;
};

export type FirmaHashInput = {
  execution_id: string;
  template_version_id: string;
  cliente_id: string;
  score_cumple: number;
  score_no_cumple: number;
  score_na: number;
  cumplimiento_pct: number | null;
  tiene_criticos_incumplidos: boolean;
  cerrada_at: string;
  firmante_nombre: string | null;
  firmante_matricula: string | null;
  firma_storage_path: string;
  respuestas: ReadonlyArray<CanonicalRespuesta>;
};

export function computeFirmaPdfHash(input: FirmaHashInput): string {
  const respuestas = [...input.respuestas]
    .sort((a, b) =>
      a.template_item_id < b.template_item_id
        ? -1
        : a.template_item_id > b.template_item_id
          ? 1
          : 0,
    )
    .map((r) => ({
      template_item_id: r.template_item_id,
      valor: r.valor ?? null,
      valor_numerico: r.valor_numerico ?? null,
      observacion: r.observacion ?? null,
      fecha_regularizacion: r.fecha_regularizacion ?? null,
    }));

  const canonical = {
    v: 1,
    execution_id: input.execution_id,
    template_version_id: input.template_version_id,
    cliente_id: input.cliente_id,
    score: {
      cumple: input.score_cumple,
      no_cumple: input.score_no_cumple,
      na: input.score_na,
      pct: input.cumplimiento_pct ?? null,
      criticos: input.tiene_criticos_incumplidos,
    },
    cerrada_at: input.cerrada_at,
    firmante: {
      nombre: input.firmante_nombre ?? null,
      matricula: input.firmante_matricula ?? null,
    },
    firma_storage_path: input.firma_storage_path,
    respuestas,
  };

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
