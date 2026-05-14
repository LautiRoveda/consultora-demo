import 'server-only';
// T-023-FU4: el route group (print) tiene root layout propio (return <html>),
// asi que NO compone con src/app/layout.tsx y no hereda su import de
// globals.css. Sin este import, Tailwind nunca se carga en el subtree print
// y todas las utility classes en PrintTemplate + <Tipo>MetadataSummaryContent
// quedan como no-op → grid colapsa a flow vertical, badges sin pill, etc.
import '@/app/globals.css';

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

  // T-024 · CSP img-src extendido al host de Supabase Storage.
  //
  // PORQUE: Puppeteer respeta las directivas CSP del response HTML que le
  // pasamos via setContent(). El CSP inicial de T-023 era `img-src 'self' data:`,
  // suficiente porque el PDF solo tenia texto + tablas (data URIs eran para
  // SVGs inline si alguno aparecia). T-024 introduce <img src> apuntando a
  // signed URLs del bucket consultora-logos + informe-attachments, que viven
  // en el host del project Supabase (ej: blijipnixnikaguojjee.supabase.co).
  // Ese host es CROSS-ORIGIN respecto a 'self' (localhost:3000 en dev, el
  // dominio productivo en prod) → CSP las bloquea silenciosamente y el PDF
  // sale con icono roto donde deberia estar el logo/foto (alt text visible
  // pero raster del icono "broken image" de Chromium).
  //
  // Fix: derivar el origin desde NEXT_PUBLIC_SUPABASE_URL (env publica, ya
  // disponible en build + runtime) y sumarlo al img-src. Mas restrictivo que
  // wildcard `*` o `https:` — solo whitelisteamos el host de NUESTRO project.
  // Si en el futuro migramos a self-hosted Storage, basta cambiar el env.
  //
  // Fallback `https:` (cualquier https) si NEXT_PUBLIC_SUPABASE_URL esta
  // ausente o malformado — sigue siendo mas restrictivo que `*` (bloquea
  // http:// + data URIs externos).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let imgSrcHosts = "'self' data:";
  if (supabaseUrl) {
    try {
      imgSrcHosts = `'self' data: ${new URL(supabaseUrl).origin}`;
    } catch {
      imgSrcHosts = "'self' data: https:";
    }
  }
  const csp = `default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src ${imgSrcHosts}; connect-src 'none'; base-uri 'none'; form-action 'none';`;

  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        {/* CSP defense-in-depth: rehype-sanitize ya strippea scripts del
            markdown, pero si alguna vez se rompe queremos que Chromium NO
            ejecute JS al renderear el PDF. img-src extendido en T-024 al
            host de Supabase para que carguen logos + attachments via signed
            URLs (ver bloque de comentario arriba para el porque). */}
        <meta httpEquiv="Content-Security-Policy" content={csp} />
        <meta name="robots" content="noindex, nofollow" />
        <title>Informe PDF</title>
      </head>
      <body className="bg-white text-zinc-900">{children}</body>
    </html>
  );
}
