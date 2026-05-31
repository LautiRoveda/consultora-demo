import 'server-only';

import * as Sentry from '@sentry/nextjs';
import pino from 'pino';

/**
 * Logger structured (pino) con captura automática de errors a Sentry.
 *
 * **Server-only.** Pino requiere APIs de Node.js (streams, fs) que no existen
 * en Edge runtime (donde corre `src/proxy.ts`) ni en el browser. Si un Client
 * Component o el proxy importa este módulo, el build de Next.js falla con un
 * mensaje explícito gracias a `import 'server-only'`.
 *
 * En Edge usar `Sentry.captureException(...)` directo desde `@sentry/nextjs`.
 * En Client Components, usar el SDK browser de Sentry (auto-instrumented por
 * `withSentryConfig` + `sentry.client.config.ts`).
 *
 * `error()` y `fatal()` además de loggear localmente, capturan el error en
 * Sentry — el dev no tiene que recordar reportar manualmente.
 */

/**
 * C6 audit · PII redact paths. Single source of truth para:
 *  - `pino.redact.paths` (logs locales + stdout en prod).
 *  - `redactSensitive(...)` helper aplicado en captureToSentry (Sentry payload).
 *
 * El doble apply es necesario porque pino y Sentry son sinks paralelos en el
 * wrapper de abajo — pino redact NO se propaga al Sentry capture.
 *
 * Cubre Ley 25.326 art 4 (minimización) + GDPR. Si un endpoint legítimamente
 * necesita el valor para alerting interno, lo loggea SOLO con una key no
 * listada acá (ej. hash del userId) o ignora esta config con un módulo aparte.
 */
const REDACT_KEYS = new Set([
  'ip',
  'email',
  'recipientEmail',
  'ownerEmail',
  'payer_email',
  'authorization',
  'password',
  'token',
  'chatId',
]);

const PINO_REDACT_PATHS = [...Array.from(REDACT_KEYS).flatMap((k) => [k, `*.${k}`])];

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  // `remove:true` elimina el campo entero en vez de mostrar [Redacted] —
  // menos data en wire + menos confusión al leer logs.
  redact: {
    paths: PINO_REDACT_PATHS,
    remove: true,
  },
  // Pretty output solo en dev. En prod queremos JSON estructurado para que
  // los log aggregators lo parseen.
  ...(process.env.NODE_ENV !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }
    : {}),
});

type LogContext = Record<string, unknown>;

/**
 * Aplica el mismo set de redactions que pino, recursivo sobre objects/arrays.
 * Devuelve un clone shallow — NO mutates el input (el caller suele pasar el
 * mismo arg a pino.error y a Sentry, no queremos efectos cruzados).
 */
function redactSensitive(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return value;
  if (Array.isArray(value)) return value.map(redactSensitive);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k)) continue;
    out[k] = redactSensitive(v);
  }
  return out;
}

function captureToSentry(arg: unknown, msg: string | undefined): void {
  if (arg instanceof Error) {
    Sentry.captureException(arg, msg ? { extra: { msg } } : undefined);
  } else if (typeof arg === 'string') {
    Sentry.captureMessage(arg, 'error');
  } else if (msg) {
    Sentry.captureMessage(msg, {
      level: 'error',
      extra: { context: redactSensitive(arg) },
    });
  } else {
    Sentry.captureMessage('Unknown error', {
      level: 'error',
      extra: { context: redactSensitive(arg) },
    });
  }
}

/**
 * Logger principal de la app.
 *
 * Métodos:
 * - `trace`/`debug`/`info`/`warn` — solo loggean localmente.
 * - `error`/`fatal` — loggean **y** capturan en Sentry.
 *
 * Firma flexible inspirada en pino:
 * - `logger.error(new Error('boom'))` — captura el Error.
 * - `logger.error(new Error('boom'), 'mensaje contexto')` — captura con extra.
 * - `logger.error('mensaje literal')` — captura como message.
 * - `logger.error({ foo: 1 }, 'mensaje')` — captura el message con context.
 */
export const logger = {
  trace: (arg: LogContext | string, msg?: string) => baseLogger.trace(arg, msg),
  debug: (arg: LogContext | string, msg?: string) => baseLogger.debug(arg, msg),
  info: (arg: LogContext | string, msg?: string) => baseLogger.info(arg, msg),
  warn: (arg: LogContext | string, msg?: string) => baseLogger.warn(arg, msg),
  error: (arg: Error | LogContext | string, msg?: string) => {
    baseLogger.error(arg, msg);
    captureToSentry(arg, msg);
  },
  fatal: (arg: Error | LogContext | string, msg?: string) => {
    baseLogger.fatal(arg, msg);
    captureToSentry(arg, msg);
  },
};

export type Logger = typeof logger;
