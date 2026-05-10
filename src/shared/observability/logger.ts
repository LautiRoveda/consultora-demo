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

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
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

function captureToSentry(arg: unknown, msg: string | undefined): void {
  if (arg instanceof Error) {
    Sentry.captureException(arg, msg ? { extra: { msg } } : undefined);
  } else if (typeof arg === 'string') {
    Sentry.captureMessage(arg, 'error');
  } else if (msg) {
    Sentry.captureMessage(msg, { level: 'error', extra: { context: arg } });
  } else {
    Sentry.captureMessage('Unknown error', { level: 'error', extra: { context: arg } });
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
