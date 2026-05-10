/**
 * Sentry SDK bootstrap para Node.js runtime (Server Components, Server
 * Actions, Route Handlers).
 *
 * Lo importa `instrumentation.ts` en su `register()` cuando
 * `process.env.NEXT_RUNTIME === 'nodejs'`.
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
  profilesSampleRate: 0,
});
