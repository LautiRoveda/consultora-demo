import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * T-148 · Guard anti-reincidencia del pipeline PDF inline.
 *
 * El bloque de orquestación del render (internal fetch + token +
 * AbortController hard cap + injectBaseHref + htmlToPdf + mapeo de errores)
 * vive una sola vez en `@/shared/pdf/render-print-page` (`renderPrintPageToPdf`).
 * Era el bloque más frágil del repo y estaba copiado en los 5 routes de PDF.
 *
 * Esta red prohíbe reintroducirlo inline en cualquier route de PDF: obliga a
 * que el 6º route (medición / RGRL / lo que venga) use el helper en vez de
 * copiar el pipeline. Es un test-meta (escanea el fuente), corre en el tier
 * unit sin DB.
 */

// Este archivo vive en src/tests/unit/ → tres niveles arriba está src/, luego app/api.
const API_DIR = join(fileURLToPath(import.meta.url), '..', '..', '..', 'app', 'api');

// Patrones de USO, no identificadores sueltos: matchean la INVOCACIÓN del
// pipeline inline (`new X` / `fn(`). Así los docblocks que mencionan htmlToPdf /
// AbortController / injectBaseHref en prosa (sin `(` ni `new`) NO disparan.
const INLINE_PIPELINE_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'new AbortController', re: /new AbortController/ },
  { label: 'injectBaseHref(', re: /injectBaseHref\s*\(/ },
  { label: 'getInternalPdfRenderToken(', re: /getInternalPdfRenderToken\s*\(/ },
  { label: 'htmlToPdf(', re: /htmlToPdf\s*\(/ },
];

// Walk recursivo con fs (NO glob `**/pdf/route.ts`: los segmentos dinámicos
// `[id]`/`[clienteId]`/`[presentacionId]` se interpretan como character class y
// devuelven 0 matches → falso verde).
function listPdfRoutes(): string[] {
  return readdirSync(API_DIR, { recursive: true })
    .map((p) => String(p).replace(/\\/g, '/'))
    .filter((p) => p.endsWith('/pdf/route.ts'))
    .map((p) => join(API_DIR, p));
}

describe('guard: pipeline PDF inline en routes (T-148)', () => {
  const routes = listPdfRoutes();

  it('encuentra los routes de PDF (no escaneó 0 archivos por glob roto)', () => {
    // >= 5, no === 5: el 6º route futuro NO debe romper el conteo — ese es
    // justamente el caso que este guard protege. El assert caza el falso verde.
    expect(routes.length).toBeGreaterThanOrEqual(5);
  });

  it('ningún route reimplementa el pipeline inline (usa renderPrintPageToPdf)', () => {
    const offenders = routes.flatMap((file) => {
      const src = readFileSync(file, 'utf8');
      const hits = INLINE_PIPELINE_PATTERNS.filter((p) => p.re.test(src)).map((p) => p.label);
      if (hits.length === 0) return [];
      const rel = relative(API_DIR, file).replace(/\\/g, '/');
      return [`${rel}: ${hits.join(', ')}`];
    });

    expect(
      offenders,
      `Route de PDF con el pipeline inline. Usá renderPrintPageToPdf / ` +
        `pdfDownloadResponse de @/shared/pdf/render-print-page (T-148):\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
