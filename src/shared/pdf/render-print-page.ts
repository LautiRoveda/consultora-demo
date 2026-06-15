import 'server-only';

import type { NextRequest } from 'next/server';

import { resolveInternalBaseUrl } from '@/shared/lib/resolve-internal-base-url';
import { logger } from '@/shared/observability/logger';

import { getInternalPdfRenderToken } from './browser-pool';
import { injectBaseHref } from './inject-base-href';
import { htmlToPdf, PdfRenderTimeoutError } from './render';

/**
 * T-148 · Pipeline compartido de render del PDF.
 *
 * Los 5 routes de PDF (informes / EPP / checklists / RAR planilla / RAR
 * historica) repetian verbatim este bloque: internal fetch al print page con
 * el token `x-internal-pdf-render`, AbortController como hard cap de 20s,
 * `injectBaseHref` + `htmlToPdf`, y el mapeo identico de errores a HTTP +
 * logs. Una sola copia mata el drift: el bloque mas fragil del repo deja de
 * vivir 5 veces.
 *
 * Contrato "thick" (decision del owner en T-148): el helper hace la
 * orquestacion, loggea con el `logPrefix`/`logBase` propio de cada route, y
 * devuelve o el Buffer del PDF o la Response 4xx/5xx ya lista. Lo que NO entra
 * aca y queda en el caller: validaciones de dominio, audit log, y el
 * `logger.info` de exito (campos propios por route).
 *
 * Punto de mock (define la byte-identidad con los tests): importa `htmlToPdf`
 * de `./render`, usa el `fetch` global, y manda el header `x-internal-pdf-render`
 * con `getInternalPdfRenderToken()`. No tocar esos 3 puntos.
 */

// Hard cap del internal fetch. Si los timeouts internos de htmlToPdf
// (setContent 10s + page.pdf 15s) fallan en disparar, este lo aborta a 20s.
const HARD_CAP_MS = 20_000;

type RenderPrintPageResult = { ok: true; pdf: Buffer } | { ok: false; response: Response };

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

export async function renderPrintPageToPdf(args: {
  request: NextRequest;
  /** Path relativo del print page, ej. `/informes/${id}/print`. */
  printPath: string;
  /** Recurso para el mensaje de error 500, ej. `el informe` / `la planilla`. */
  recurso: string;
  /** Prefijo del mensaje de log, ej. `pdf_route`. */
  logPrefix: string;
  /**
   * Contexto base del log: `{ [idKey]: id, userId, consultoraId }`. El orden
   * de las keys importa para la byte-identidad del payload — se copia verbatim
   * del route (idKey propio: informeId / entregaId / executionId / clienteId /
   * presentacionId).
   */
  logBase: Record<string, unknown>;
}): Promise<RenderPrintPageResult> {
  const { request, printPath, recurso, logPrefix, logBase } = args;

  // Internal fetch al print page. Pasamos las cookies del request original
  // para que el `createClient()` de adentro vea la sesion. El token defiende
  // contra acceso directo desde browser.
  const baseUrl = resolveInternalBaseUrl(request);
  const cookieHeader = request.headers.get('cookie') ?? '';
  const printUrl = `${baseUrl}${printPath}`;

  const ac = new AbortController();
  const hardCap = setTimeout(() => ac.abort(), HARD_CAP_MS);

  let html: string;
  try {
    const printRes = await fetch(printUrl, {
      method: 'GET',
      headers: {
        cookie: cookieHeader,
        'x-internal-pdf-render': getInternalPdfRenderToken(),
      },
      signal: ac.signal,
      // Bypass de cualquier cache (no deberia haber, pero defensivo).
      cache: 'no-store',
    });
    if (!printRes.ok) {
      clearTimeout(hardCap);
      logger.error({ ...logBase, status: printRes.status }, `${logPrefix}: print page fetch fallo`);
      return {
        ok: false,
        response: errorResponse(500, 'INTERNAL_ERROR', `No se pudo renderear ${recurso}.`),
      };
    }
    html = await printRes.text();
  } catch (err) {
    clearTimeout(hardCap);
    if (ac.signal.aborted) {
      logger.warn({ ...logBase }, `${logPrefix}: hard cap timeout en internal fetch`);
      return {
        ok: false,
        response: errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.'),
      };
    }
    logger.error({ err: String(err), ...logBase }, `${logPrefix}: internal fetch fallo`);
    return {
      ok: false,
      response: errorResponse(500, 'INTERNAL_ERROR', `No se pudo renderear ${recurso}.`),
    };
  }

  // HTML → PDF. Inyectamos `<base href>` antes de pasar a Puppeteer porque
  // `setContent` renderea en about:blank y las URLs relativas del CSS de
  // Tailwind no resuelven sin base. Reusamos el `baseUrl` ya computed arriba.
  const htmlWithBase = injectBaseHref(html, baseUrl);
  let pdf: Buffer;
  try {
    pdf = await htmlToPdf(htmlWithBase);
  } catch (err) {
    clearTimeout(hardCap);
    if (err instanceof PdfRenderTimeoutError) {
      logger.warn({ ...logBase, stage: err.message }, `${logPrefix}: render timeout`);
      return {
        ok: false,
        response: errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.'),
      };
    }
    logger.error({ err: String(err), ...logBase }, `${logPrefix}: htmlToPdf fallo`);
    return {
      ok: false,
      response: errorResponse(500, 'INTERNAL_ERROR', 'Hubo un error generando el PDF.'),
    };
  }
  clearTimeout(hardCap);

  return { ok: true, pdf };
}

/**
 * Response 200 de descarga del PDF. Headers identicos en los 5 routes:
 * Content-Disposition RFC 6266 (ascii + filename* UTF-8 para acentos),
 * Cache-Control private no-store, X-Robots-Tag noindex.
 */
export function pdfDownloadResponse(args: { pdf: Buffer; filename: string }): Response {
  const { pdf, filename } = args;
  const asciiFilename = filename.replace(/[^\x20-\x7e]/g, '_');
  const utf8Filename = encodeURIComponent(filename);
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${utf8Filename}`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
