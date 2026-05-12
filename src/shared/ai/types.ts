/**
 * T-020 · Types compartidos del modulo AI.
 *
 * Discriminated union de errores expuesta al cliente. Los codes son estables
 * (forman parte del contrato con el client) — agregar nuevos OK, renombrar
 * existentes requiere coordinacion.
 */

export type AiErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHENTICATED'
  | 'NO_CONSULTORA'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'CONTENT_FILTER'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

/**
 * Metadata de uso de tokens. Reportada al cliente para que la UI pueda
 * mostrar costos / consumos cuando T-021 traiga tracking per-consultora.
 *
 * En T-020 el cliente la ignora — solo loggeamos en pino/Sentry.
 */
export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};
