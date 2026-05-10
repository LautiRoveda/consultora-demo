'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Global error boundary de Next.js App Router.
 *
 * Captura errores que escapan del root layout (errores que rompen el
 * provider tree, errores en el propio layout). Sin este archivo, Sentry no
 * recibe los errores no-handled del lado client.
 *
 * Es un Client Component que renderiza HTML completo (no envuelto por el
 * root layout) — por eso lleva sus propios `<html>` y `<body>`.
 *
 * UI mínima en T-007 — T-009 le da estilo definitivo.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es-AR">
      <body>
        <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
          <h1>Algo salió mal</h1>
          <p>Ya estamos investigando. Probá refrescar la página o volvé en unos minutos.</p>
        </main>
      </body>
    </html>
  );
}
