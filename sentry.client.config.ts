/**
 * Sentry SDK bootstrap para el browser (client-side).
 *
 * Se carga automáticamente en el bundle del cliente cuando `withSentryConfig`
 * envuelve el `next.config.ts`. NO importa `@/env` porque ese módulo es
 * server-only — el cliente lee `process.env.NEXT_PUBLIC_*` directo (Next.js
 * los inlinea en build time).
 *
 * Replay y Profiling deshabilitados (0) — se activan cuando haya tracción
 * (ver `src/shared/observability/sentry-config-base.ts`).
 */

import * as Sentry from '@sentry/nextjs';

import {
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
  SENTRY_TRACES_SAMPLE_RATE,
} from '@/shared/observability/sentry-config-base';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  // Hint para el SDK que no incluya integraciones que pesan en el bundle.
  integrations: [],
});
