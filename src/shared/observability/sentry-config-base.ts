/**
 * Configuración compartida entre las 3 configs Sentry (client, server, edge).
 *
 * **No es server-only.** Este módulo lo importan también las configs que se
 * empacan al bundle del cliente (`sentry.client.config.ts`). Solo lee
 * `process.env.NODE_ENV` y `process.env.SENTRY_FORCE_ENABLE` — ambas son
 * variables que Next.js inlinea en build time como literales (la primera) o
 * que están disponibles en runtime con un fallback seguro (la segunda).
 *
 * Razón de existir: una sola fuente de verdad para sample rates y `enabled` —
 * cambiar la política se hace en un archivo, no en tres.
 */

/**
 * `enabled` flag para `Sentry.init()`.
 *
 * - `true` en producción siempre.
 * - `true` en dev/test si el dev seteó `SENTRY_FORCE_ENABLE=true` en
 *   `.env.local` (validación end-to-end manual de `/api/test-error`).
 * - `false` en cualquier otro caso → `Sentry.captureException` y compañía
 *   se vuelven no-op, no se manda nada al servidor de Sentry. Esto evita
 *   ensuciar el dashboard con noise de dev/test/CI.
 */
export const SENTRY_ENABLED =
  process.env.NODE_ENV === 'production' || process.env.SENTRY_FORCE_ENABLE === 'true';

/**
 * Tasa de muestreo de traces (performance monitoring).
 *
 * - 5% en prod (P9 · costo bajo control: no agotar el budget free tier).
 * - 10% en dev/test (más data para debugging cuando hace falta).
 *
 * Replay y Profiling están deshabilitados explícitamente en cada config con 0.
 */
export const SENTRY_TRACES_SAMPLE_RATE = process.env.NODE_ENV === 'production' ? 0.05 : 0.1;

/**
 * Environment tag para Sentry. Distingue prod/staging/dev en el dashboard.
 * Default: el `NODE_ENV` de Node, fallback a `'development'` si está ausente.
 */
export const SENTRY_ENVIRONMENT = process.env.NODE_ENV ?? 'development';
