import 'server-only';

import type { StreamErrorCode, StreamEvent } from '@/shared/ai/stream';
import Anthropic from '@anthropic-ai/sdk';

import { logger } from '@/shared/observability/logger';

/**
 * T-117-FU3 · Primitivas de transporte SSE compartidas entre los streams de IA:
 * `streamAnthropicMessage` (informes, T-025) y `streamEppChat` (asistente EPP).
 *
 * Por que un modulo aparte: ambos consumidores deben compartir UNA sola
 * codificacion de eventos + UN solo mapping de errores del SDK. El formato del
 * wire es identico al de T-025 (los tests de informes asertan tipos/orden/codigos
 * via `parseSseStream`), asi que extraer esto no cambia los bytes emitidos.
 */

/**
 * Eventos SSE. Superset del contrato de informes (`StreamEvent`) + el evento
 * `tool` del asistente: lo emite el orquestador justo antes de dispatchear una
 * tool para que el cliente muestre un chip de estado ("Buscando empleado...")
 * mientras corre la query. El payload lleva el `name` crudo de la tool — el
 * mapeo a label legible vive en el cliente.
 */
export type SseStreamEvent = StreamEvent | { type: 'tool'; name: string };

// Un unico encoder a nivel modulo (en T-025 vivia en el closure de stream.ts).
const encoder = new TextEncoder();

/**
 * Serializa un evento al formato SSE `event: <type>\ndata: <json>\n\n`. Bytes
 * identicos al `encodeEvent` original de T-025 para los tipos existentes;
 * agrega el caso `tool`.
 */
export function encodeSseEvent(ev: SseStreamEvent): Uint8Array {
  const payload =
    ev.type === 'delta'
      ? { text: ev.text }
      : ev.type === 'tool'
        ? { name: ev.name }
        : ev.type === 'usage'
          ? ev.usage
          : ev.type === 'stop'
            ? { reason: ev.reason }
            : ev.type === 'error'
              ? { code: ev.code, message: ev.message }
              : {};
  return encoder.encode(`event: ${ev.type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** True si el error proviene de un abort (el SDK respeto `signal.aborted`). */
export function isAbortError(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

/** Dominio del consumidor — solo afecta el texto de algunos mensajes de error. */
export type SseErrorDomain = 'informe' | 'chat';

const DOMAIN_NOUN: Record<SseErrorDomain, string> = {
  informe: 'el informe',
  chat: 'la respuesta',
};

/**
 * Mapea un error del SDK Anthropic al evento SSE `error`. Concentra el mapping
 * en un solo lugar (mismo criterio que T-020). `logCtx` es laxo para servir a
 * ambos dominios (informes loguea {informeId, consultoraId, userId}; el chat
 * loguea {consultoraId, userId}). `domain` solo cambia el sustantivo de los
 * mensajes que mencionaban "el informe" — los demas son neutros e identicos a
 * los de T-025.
 */
export function mapAnthropicError(
  err: unknown,
  logCtx: Record<string, unknown>,
  opts: { domain: SseErrorDomain },
): { type: 'error'; code: StreamErrorCode; message: string } {
  const noun = DOMAIN_NOUN[opts.domain];
  if (err instanceof Anthropic.RateLimitError) {
    logger.warn(logCtx, 'anthropic_rate_limited');
    return {
      type: 'error',
      code: 'RATE_LIMITED',
      message: 'La IA está saturada. Probá en unos minutos.',
    };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    logger.warn(logCtx, 'anthropic_timeout');
    return {
      type: 'error',
      code: 'TIMEOUT',
      message: 'La IA tardó demasiado. Intentá de nuevo.',
    };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    logger.error(logCtx, 'anthropic_auth_failed');
    return {
      type: 'error',
      code: 'INTERNAL_ERROR',
      message: `Hubo un error generando ${noun}. Reintentá en unos minutos.`,
    };
  }
  if (err instanceof Anthropic.APIError) {
    logger.error({ ...logCtx, status: err.status }, 'anthropic_api_error');
    return {
      type: 'error',
      code: 'INTERNAL_ERROR',
      message: 'La IA falló. Intentá de nuevo.',
    };
  }
  logger.error({ ...logCtx, err: String(err) }, 'anthropic_unexpected_error');
  return {
    type: 'error',
    code: 'INTERNAL_ERROR',
    message: `Hubo un error inesperado generando ${noun}.`,
  };
}
