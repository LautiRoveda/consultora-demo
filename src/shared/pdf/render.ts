import 'server-only';

import { logger } from '@/shared/observability/logger';

import { bumpIdle, getBrowser } from './browser-pool';

/**
 * T-023 · Wrapper minimal sobre Puppeteer para convertir HTML → PDF.
 *
 * Reusa el browser singleton de `./browser-pool.ts`. Cada PDF abre/cierra
 * su propia Page — page-close en `finally` es no-negociable (leak de Page
 * = leak de memoria de Chromium).
 *
 * Timeouts en cascada (defensa en profundidad):
 *  - `setContent` 10s: si la pagina tarda en parsear/layout, abort.
 *  - `page.pdf` 15s: si el render visual cuelga, abort.
 *  - El caller (route handler) suma un AbortController de 20s como hard cap.
 *
 * Errores especificos:
 *  - `PdfRenderTimeoutError`: alguno de los timeouts internos disparo. El
 *    caller mapea a HTTP 504.
 *  - Cualquier otra excepcion sale tal cual (caller mapea a 500).
 */

export class PdfRenderTimeoutError extends Error {
  constructor(stage: 'setContent' | 'pdf', timeoutMs: number) {
    super(`PDF render timeout en stage "${stage}" (${timeoutMs} ms)`);
    this.name = 'PdfRenderTimeoutError';
  }
}

export type HtmlToPdfOptions = {
  /** Activa header/footer del print engine. Default true (paginas con N de M). */
  displayHeaderFooter?: boolean;
  /** HTML del header de pagina (Puppeteer reemplaza `<span class="pageNumber">` etc). */
  headerTemplate?: string;
  /** HTML del footer de pagina. */
  footerTemplate?: string;
  /** Margenes A4 estandar; valores en CSS units. */
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
};

// T-023-FU3 (#46) · bottom margin subio de 24mm → 30mm para evitar el footer
// overlap con la ultima linea del body en pagina 1. El header del PrintTemplate
// (logo + titulo + metadata) ocupa mas espacio en la primera pagina, asi que
// el body llega mas cerca del borde inferior — necesita area de footer mayor.
const DEFAULT_MARGIN = {
  top: '22mm',
  right: '18mm',
  bottom: '30mm',
  left: '18mm',
};

const SET_CONTENT_TIMEOUT_MS = 10_000;
const PDF_TIMEOUT_MS = 15_000;

/**
 * Renderea `html` a PDF A4 usando el browser singleton.
 *
 * Concurrent calls son safe: cada una abre su propia Page sobre el mismo
 * Browser. Puppeteer maneja la cola interna del DevTools Protocol.
 */
export async function htmlToPdf(html: string, opts: HtmlToPdfOptions = {}): Promise<Buffer> {
  const t0 = Date.now();
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.emulateMediaType('print');

    try {
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: SET_CONTENT_TIMEOUT_MS,
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        throw new PdfRenderTimeoutError('setContent', SET_CONTENT_TIMEOUT_MS);
      }
      throw err;
    }

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: false,
        displayHeaderFooter: opts.displayHeaderFooter ?? true,
        headerTemplate: opts.headerTemplate ?? defaultHeaderTemplate(),
        footerTemplate: opts.footerTemplate ?? defaultFooterTemplate(),
        margin: {
          top: opts.margin?.top ?? DEFAULT_MARGIN.top,
          right: opts.margin?.right ?? DEFAULT_MARGIN.right,
          bottom: opts.margin?.bottom ?? DEFAULT_MARGIN.bottom,
          left: opts.margin?.left ?? DEFAULT_MARGIN.left,
        },
        timeout: PDF_TIMEOUT_MS,
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        throw new PdfRenderTimeoutError('pdf', PDF_TIMEOUT_MS);
      }
      throw err;
    }

    // Puppeteer v22+ devuelve Uint8Array; Buffer.from copia los bytes a un
    // Buffer para que el caller pueda hacer .length + setHeader sin cast.
    const buf = Buffer.from(pdfBytes);
    logger.info({ ms: Date.now() - t0, bytes: buf.length }, 'pdf_render_ok');
    return buf;
  } finally {
    // CRITICO: cerrar la page o leak de RAM en Chromium. `catch` para no
    // tirar desde el finally si la page ya esta detached.
    await page.close().catch(() => {});
    bumpIdle();
  }
}

/**
 * Heuristica para detectar timeouts de Puppeteer. Las clases concretas
 * (`TimeoutError`) se exportan desde subpaths que pueden cambiar entre
 * versiones; matchear por nombre es estable y suficiente.
 */
function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'TimeoutError' || err.message.toLowerCase().includes('timeout');
  }
  return false;
}

/**
 * Header default (paginas >= 2). La primera pagina del documento ya tiene
 * su propio header en el body del HTML — Puppeteer lo dibuja arriba de
 * ese header solo en las paginas siguientes (con `display:none` para la
 * primera, manejado por el caller si quiere). Mantenemos minimal: el
 * branding ya esta en el body.
 */
function defaultHeaderTemplate(): string {
  // Vacio pero NO ''; Puppeteer requiere algun HTML valido o el primer
  // espacio del top margin se rompe. Un span vacio con font-size:0 es
  // el truco estandar.
  return '<span style="font-size: 0;"></span>';
}

/**
 * Footer default — disclaimer + numero de pagina. Aparece en todas las
 * paginas. Estilo inline-only porque el print engine de Chromium ignora
 * stylesheets externas en header/footer templates.
 *
 * T-023-FU3 (#46): font-size bajo 8pt → 7pt y se sumo padding-top 4mm
 * para evitar overlap del footer con la ultima linea del body en pagina 1.
 * El area de footer (DEFAULT_MARGIN.bottom = 30mm) ahora aloja al footer
 * con 4mm de aire arriba antes de comenzar el texto del disclaimer.
 */
function defaultFooterTemplate(): string {
  return `
    <div style="font-size: 7pt; padding-top: 4mm; padding-left: 18mm; padding-right: 18mm; color: #71717a; width: 100%; display: flex; justify-content: space-between; align-items: center; font-family: -apple-system, system-ui, sans-serif;">
      <span>Documento generado por ConsultoraDemo. El profesional matriculado firmante asume la responsabilidad técnica.</span>
      <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
    </div>
  `;
}
