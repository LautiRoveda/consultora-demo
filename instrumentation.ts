/**
 * Instrumentation hook de Next.js 16.
 *
 * `register()` se invoca una vez cuando arranca el server, y carga la config
 * de Sentry correspondiente al runtime activo. Es la API canónica para
 * inicializar SDKs server-side en Next.js 15+; reemplaza al patrón viejo de
 * `sentry.server.config.ts` cargado por convención.
 *
 * Las configs server / edge siguen viviendo en archivos separados como pidió
 * el plan T-007 — este archivo solo orquesta.
 *
 * `onRequestError` re-exporta el hook nuevo de Next.js 15.3+ que captura
 * errores no-handled de Server Components / Server Actions / Route Handlers.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
