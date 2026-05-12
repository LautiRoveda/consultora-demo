import 'server-only';

import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { getInternalPdfRenderToken } from '@/shared/pdf/browser-pool';

/**
 * T-023 · Layout del route group `(print)`.
 *
 * Sibling de `(app)` a proposito: un nested layout dentro de `(app)/` se
 * compone CON `AppShell` (no lo reemplaza). Para tener un HTML print-clean
 * sin sidebar/topnav, la unica forma en Next.js App Router es estar fuera
 * del grupo `(app)`. `(print)` cumple ese rol y mantiene `/informes/[id]/print`
 * como URL (los grupos no afectan el path).
 *
 * Defensa de acceso: este layout valida que el request traiga el header
 * `x-internal-pdf-render` matcheando el token efimero del proceso. El token
 * se genera con `crypto.randomBytes(32).toString('hex')` al boot (ver
 * `src/shared/pdf/browser-pool.ts`) y NO se expone a clientes externos —
 * solo el route handler `/api/informes/[id]/pdf` lo inyecta al fetchar este
 * page server-side. Cualquier acceso directo desde un browser → notFound().
 *
 * No carga AppShell ni hace auth check. La page child puede usar
 * `createClient()` y `auth.getUser()` (las cookies del request fluyen por
 * el fetch interno) — pero la fuente de verdad de auth es el route handler
 * que ya validó antes de iniciar el render.
 */
export default async function PrintLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const supplied = h.get('x-internal-pdf-render');
  const expected = getInternalPdfRenderToken();

  // Comparacion en tiempo constante seria ideal contra timing attacks; en la
  // practica el token vive solo en memoria del proceso y el atacante no tiene
  // canal para medir tiempos (no hay error message distinto). Comparacion
  // directa es suficiente para este threat model.
  if (!supplied || supplied !== expected) {
    notFound();
  }

  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        {/* CSP defense-in-depth: rehype-sanitize ya strippea scripts del
            markdown, pero si alguna vez se rompe queremos que Chromium NO
            ejecute JS al renderear el PDF. */}
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none';"
        />
        <meta name="robots" content="noindex, nofollow" />
        <title>Informe PDF</title>
      </head>
      <body className="bg-white text-zinc-900">{children}</body>
    </html>
  );
}
