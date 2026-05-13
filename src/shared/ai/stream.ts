import 'server-only';

import type { AiErrorCode, AiUsage } from '@/shared/ai/types';
import Anthropic from '@anthropic-ai/sdk';

import { getAnthropicClient } from '@/shared/ai/anthropic';
import { logger } from '@/shared/observability/logger';

/**
 * T-025 · Wrapper de `client.messages.stream()` que devuelve un
 * `ReadableStream<Uint8Array>` en formato SSE listo para usar como body
 * de `Response` en un Route Handler.
 *
 * Por que un wrapper y no inline en la route:
 *  - El mapping SDK event → contrato SSE es reusable para futuros endpoints
 *    de IA (capacitaciones, accidentabilidad).
 *  - El mapping de errores del SDK al discriminated union se concentra en
 *    un solo lugar — match conceptual con `mapAnthropicError` de T-020.
 *  - Testeable de forma aislada con mocks de `messages.stream()`.
 *
 * Garantias del wrapper:
 *  - NUNCA tira. Errores del SDK se traducen a un evento `error` SSE seguido
 *    de cierre del controller. El Route Handler solo setea headers + retorna
 *    `new Response(stream, ...)`.
 *  - Honra `signal.aborted` — cuando el cliente corta, el SDK aborta el HTTP
 *    request a Anthropic y el wrapper cierra el ReadableStream.
 *  - El callback `onComplete` solo se llama cuando llega `message_stop` con
 *    stop_reason valido (no en aborts ni errores). Ahi el Route Handler
 *    persiste el audit log.
 *  - El callback `onAbort` se llama cuando el cliente cancela mid-stream.
 *    Pino-only — no va a audit_log (decision T-025: aborts no son evento
 *    legal, son telemetria).
 */

/** Codes del contrato SSE. Mismos 9 de T-020 + un nuevo para aborts. */
export type StreamErrorCode = AiErrorCode | 'STREAM_ABORTED';

/**
 * Eventos del contrato SSE expuestos al cliente. Independientes del shape
 * crudo del SDK — la traduccion vive en el wrapper.
 */
export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: AiUsage }
  | { type: 'stop'; reason: string }
  | { type: 'error'; code: StreamErrorCode; message: string }
  | { type: 'done' };

export type StreamCompleteInfo = {
  usage: AiUsage;
  stopReason: string | null;
  bytesEmitted: number;
  chunksEmitted: number;
  ms: number;
  model: string;
};

export type StreamAbortInfo = {
  bytesEmitted: number;
  chunksEmitted: number;
  ms: number;
};

export type StreamCallbacks = {
  /** Llamado UNA SOLA VEZ al final de un stream exitoso (post-message_stop). */
  onComplete?: (info: StreamCompleteInfo) => void;
  /** Llamado UNA SOLA VEZ si el cliente abort el stream mid-flight. */
  onAbort?: (info: StreamAbortInfo) => void;
};

export type StreamContext = {
  informeId: string;
  consultoraId: string;
  userId: string;
};

export function streamAnthropicMessage(
  params: Anthropic.MessageStreamParams,
  options: {
    signal: AbortSignal;
    callbacks?: StreamCallbacks;
    ctx: StreamContext;
  },
): ReadableStream<Uint8Array> {
  const { signal, callbacks, ctx } = options;
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const t0 = Date.now();
      let bytesEmitted = 0;
      let chunksEmitted = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadInputTokens = 0;
      let cacheCreationInputTokens = 0;
      let stopReason: string | null = null;
      let model = '';
      let closed = false;

      function encodeEvent(ev: StreamEvent): Uint8Array {
        const payload =
          ev.type === 'delta'
            ? { text: ev.text }
            : ev.type === 'usage'
              ? ev.usage
              : ev.type === 'stop'
                ? { reason: ev.reason }
                : ev.type === 'error'
                  ? { code: ev.code, message: ev.message }
                  : {};
        return encoder.encode(`event: ${ev.type}\ndata: ${JSON.stringify(payload)}\n\n`);
      }

      function enqueue(ev: StreamEvent): void {
        if (closed) return;
        try {
          controller.enqueue(encodeEvent(ev));
          if (ev.type === 'delta') {
            bytesEmitted += ev.text.length;
            chunksEmitted += 1;
          }
        } catch {
          // Controller cerrado por el consumer (cliente cerro la conexion
          // entre el check de aborted y este enqueue). Silenciamos — el
          // proximo iter chequea `signal.aborted` y rompe el loop.
          closed = true;
        }
      }

      function close(): void {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Ya cerrado por el consumer.
        }
      }

      try {
        const sdkStream = getAnthropicClient().messages.stream(params, { signal });
        for await (const event of sdkStream) {
          if (signal.aborted) break;
          switch (event.type) {
            case 'message_start': {
              const msg = event.message;
              model = msg.model;
              inputTokens = msg.usage.input_tokens;
              cacheReadInputTokens = msg.usage.cache_read_input_tokens ?? 0;
              cacheCreationInputTokens = msg.usage.cache_creation_input_tokens ?? 0;
              break;
            }
            case 'content_block_delta': {
              if (event.delta.type === 'text_delta') {
                enqueue({ type: 'delta', text: event.delta.text });
              }
              // input_json_delta, thinking_delta, signature_delta, citations_delta:
              // No los usamos en T-025 (sin tools, sin thinking, sin citations).
              break;
            }
            case 'message_delta': {
              if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
              if (event.usage?.output_tokens !== undefined) {
                outputTokens = event.usage.output_tokens;
              }
              break;
            }
            // message_stop / content_block_start / content_block_stop:
            // No los reflejamos al cliente — el cierre del stream + evento
            // `done` cubren la semantica de "termino".
          }
        }

        if (signal.aborted) {
          enqueue({
            type: 'error',
            code: 'STREAM_ABORTED',
            message: 'Generación cancelada.',
          });
          close();
          callbacks?.onAbort?.({
            bytesEmitted,
            chunksEmitted,
            ms: Date.now() - t0,
          });
          return;
        }

        // stop_reason='refusal' → CONTENT_FILTER (mismo mapping que T-020).
        if (stopReason === 'refusal') {
          logger.warn(ctx, 'anthropic_refusal');
          enqueue({
            type: 'error',
            code: 'CONTENT_FILTER',
            message:
              'El modelo se rehusó a generar este contenido. Probá con un prompt distinto o un tipo de informe diferente.',
          });
          close();
          return;
        }

        const usage: AiUsage = {
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens,
        };
        enqueue({ type: 'stop', reason: stopReason ?? 'end_turn' });
        enqueue({ type: 'usage', usage });
        enqueue({ type: 'done' });
        close();

        callbacks?.onComplete?.({
          usage,
          stopReason,
          bytesEmitted,
          chunksEmitted,
          ms: Date.now() - t0,
          model,
        });
      } catch (err) {
        // El SDK puede tirar APIUserAbortError cuando se respeta el signal.
        // Lo tratamos como STREAM_ABORTED en lugar de error genuino.
        if (signal.aborted || isAbortError(err)) {
          enqueue({
            type: 'error',
            code: 'STREAM_ABORTED',
            message: 'Generación cancelada.',
          });
          close();
          callbacks?.onAbort?.({
            bytesEmitted,
            chunksEmitted,
            ms: Date.now() - t0,
          });
          return;
        }
        const mapped = mapAnthropicError(err, ctx);
        enqueue(mapped);
        close();
      }
    },

    cancel() {
      // El consumer (Route Handler) cerro el stream sin esperar a `done`.
      // No-op: ya cerramos via signal.aborted o via close() arriba.
    },
  });
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

function mapAnthropicError(
  err: unknown,
  ctx: StreamContext,
): { type: 'error'; code: StreamErrorCode; message: string } {
  if (err instanceof Anthropic.RateLimitError) {
    logger.warn(ctx, 'anthropic_rate_limited');
    return {
      type: 'error',
      code: 'RATE_LIMITED',
      message: 'La IA está saturada. Probá en unos minutos.',
    };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    logger.warn(ctx, 'anthropic_timeout');
    return {
      type: 'error',
      code: 'TIMEOUT',
      message: 'La IA tardó demasiado. Intentá de nuevo.',
    };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    logger.error(ctx, 'anthropic_auth_failed');
    return {
      type: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error generando el informe. Reintentá en unos minutos.',
    };
  }
  if (err instanceof Anthropic.APIError) {
    logger.error({ ...ctx, status: err.status }, 'anthropic_api_error');
    return {
      type: 'error',
      code: 'INTERNAL_ERROR',
      message: 'La IA falló. Intentá de nuevo.',
    };
  }
  logger.error({ ...ctx, err: String(err) }, 'anthropic_unexpected_error');
  return {
    type: 'error',
    code: 'INTERNAL_ERROR',
    message: 'Hubo un error inesperado generando el informe.',
  };
}
