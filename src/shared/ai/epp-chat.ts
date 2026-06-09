import 'server-only';

/**
 * T-117 · Helpers compartidos del asistente IA de EPP.
 *
 * El orquestador productivo es `streamEppChat` ([src/shared/ai/epp-chat-stream.ts],
 * T-117-FU3 — streaming SSE tool-aware). Este modulo concentra los tipos + el
 * calculo de tokens/costo que el orquestador usa. (Hasta T-117-FU3 vivia aca
 * `runEppChat`, el orquestador no-streaming; lo reemplazo el path SSE.)
 */

// Haiku 4.5 pricing (USD por 1M tokens) — mismo criterio que epp-suggest.
const HAIKU_INPUT_PRICE_PER_M = 1.0;
const HAIKU_OUTPUT_PRICE_PER_M = 5.0;

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type ChatTokens = { input: number; output: number; cost_usd: number };

/** Tokens acumulados → estructura con costo (Haiku $1/$5 por 1M). */
export function toTokens(input: number, output: number): ChatTokens {
  return {
    input,
    output,
    cost_usd:
      (input / 1_000_000) * HAIKU_INPUT_PRICE_PER_M +
      (output / 1_000_000) * HAIKU_OUTPUT_PRICE_PER_M,
  };
}
