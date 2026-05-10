import { notFound } from 'next/navigation';

/**
 * Endpoint de validación end-to-end de Sentry.
 *
 * Hit `GET /api/test-error` desde dev → tira un Error que el SDK server captura
 * automáticamente vía `instrumentation.ts → onRequestError`.
 *
 * **Gated por `NODE_ENV !== 'production'`.** En producción devuelve 404 — el
 * endpoint queda como dev tool persistente para validar la integración con
 * Sentry sin riesgo de exposición.
 *
 * Para que el evento llegue de verdad a `sentry.io`:
 *
 * ```bash
 * # En .env.local:
 * SENTRY_FORCE_ENABLE=true
 *
 * pnpm dev
 * curl http://localhost:3000/api/test-error
 * # Verificar en sentry.io/organizations/<SENTRY_ORG>/issues/ en ~30s.
 * ```
 *
 * Ver `src/shared/observability/README.md` para detalle.
 */
export function GET() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  throw new Error(
    'Test error desde /api/test-error — debe llegar a Sentry si SENTRY_FORCE_ENABLE=true.',
  );
}
