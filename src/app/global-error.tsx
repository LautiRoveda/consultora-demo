'use client';

import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
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
 * IMPORTANTE: NO importar shadcn ni usar Tailwind acá. Este boundary puede
 * dispararse cuando el provider tree del root layout está roto y
 * Tailwind/contexto no están disponibles. HTML válido + CSS inline.
 *
 * Colores en oklch() — match exacto con `--primary` y `--foreground` de
 * `globals.css` (line 19-35). Soporte: Chrome 111+, Safari 15.4+, FF 113+.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es-AR">
      <body
        style={{
          margin: 0,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          backgroundColor: 'oklch(0.985 0 0)',
          color: 'oklch(0.141 0.005 285.823)',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
        }}
      >
        <main
          style={{
            maxWidth: '28rem',
            width: '100%',
            backgroundColor: 'oklch(1 0 0)',
            border: '1px solid oklch(0.92 0.004 286.32)',
            borderRadius: '0.5rem',
            padding: '2rem',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1.5rem',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '2rem',
                height: '2rem',
                borderRadius: '0.375rem',
                backgroundColor: 'oklch(0.511 0.262 276.966)',
                color: 'oklch(0.985 0 0)',
                fontWeight: 700,
                fontSize: '0.875rem',
              }}
            >
              CD
            </span>
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>ConsultoraDemo</span>
          </div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              margin: '0 0 0.75rem',
            }}
          >
            Algo salió mal
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'oklch(0.552 0.016 285.938)',
              margin: '0 0 1.5rem',
              lineHeight: 1.5,
            }}
          >
            Hubo un problema cargando la página. Intentá refrescar o volvé al inicio.
          </p>
          <Link
            href="/"
            style={{
              display: 'inline-block',
              padding: '0.5rem 1rem',
              backgroundColor: 'oklch(0.511 0.262 276.966)',
              color: 'oklch(0.985 0 0)',
              textDecoration: 'none',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Volver al inicio
          </Link>
        </main>
      </body>
    </html>
  );
}
