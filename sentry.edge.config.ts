/**
 * Sentry SDK bootstrap para Edge runtime (`src/proxy.ts` y eventuales
 * Route Handlers con `export const runtime = 'edge'`).
 *
 * Lo importa `instrumentation.ts` en su `register()` cuando
 * `process.env.NEXT_RUNTIME === 'edge'`.
 *
 * Edge runtime no soporta profiling (no hay APIs de Node.js disponibles).
 */

import * as Sentry from '@sentry/nextjs';

import { env } from '@/env';
import {
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
  SENTRY_TRACES_SAMPLE_RATE,
} from '@/shared/observability/sentry-config-base';

Sentry.init({
  dsn: env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
});
