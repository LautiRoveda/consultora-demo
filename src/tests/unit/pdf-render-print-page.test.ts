import type { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/shared/observability/logger';
import { htmlToPdf, PdfRenderTimeoutError } from '@/shared/pdf/render';
import { pdfDownloadResponse, renderPrintPageToPdf } from '@/shared/pdf/render-print-page';

/**
 * T-148 · Unit del pipeline compartido `renderPrintPageToPdf` + `pdfDownloadResponse`.
 *
 * Mockea los mismos puntos que los 6 integration tests de los routes de PDF:
 * `@/shared/pdf/render` (htmlToPdf), el `fetch` global y el token. Cubre los 5
 * caminos de error + el ok, y los headers de descarga.
 */

// El helper hace `import 'server-only'`; en el environment node de vitest unit
// explota sin stub (mismo patrón que pdf-inject-base-href.test.ts).
vi.mock('server-only', () => ({}));

vi.mock('@/shared/observability/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
  },
}));

// Token determinista de 64 hex (matchea el regex que asertan los integration
// tests) y evita importar puppeteer-core de browser-pool en el tier unit.
vi.mock('@/shared/pdf/browser-pool', () => ({
  getInternalPdfRenderToken: () => 'a'.repeat(64),
}));

// htmlToPdf controlable + la MISMA clase de error que el helper usa en el
// `instanceof` (se importa de este módulo mockeado).
vi.mock('@/shared/pdf/render', () => ({
  htmlToPdf: vi.fn(),
  PdfRenderTimeoutError: class PdfRenderTimeoutError extends Error {
    constructor(stage: string, timeoutMs: number) {
      super(`PDF render timeout en stage "${stage}" (${timeoutMs} ms)`);
      this.name = 'PdfRenderTimeoutError';
    }
  },
}));

const mockHtmlToPdf = htmlToPdf as unknown as Mock;
const FAKE_PDF = Buffer.from('%PDF-1.4\n%fake\n%%EOF\n', 'utf-8');

function makeReq(cookie = 'sb-access-token=xyz'): NextRequest {
  return {
    url: 'http://localhost:3000/api/test/pdf',
    headers: { get: (k: string) => (k.toLowerCase() === 'cookie' ? cookie : null) },
  } as unknown as NextRequest;
}

const BASE_ARGS = {
  printPath: '/informes/abc-123/print',
  recurso: 'el informe',
  logPrefix: 'pdf_route',
  logBase: { informeId: 'abc-123', userId: 'u1', consultoraId: 'c1' },
};

function okFetch() {
  return vi.fn().mockResolvedValue(
    new Response('<html><head></head><body>print</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }),
  );
}

async function readJson(res: Response): Promise<{ code: string; message: string }> {
  return (await res.json()) as { code: string; message: string };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHtmlToPdf.mockResolvedValue(FAKE_PDF);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderPrintPageToPdf', () => {
  it('ok: devuelve el Buffer y manda cookie + token al print page', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderPrintPageToPdf({ request: makeReq(), ...BASE_ARGS });

    expect(result).toEqual({ ok: true, pdf: FAKE_PDF });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/informes/abc-123/print');
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
    expect(init.headers.cookie).toBe('sb-access-token=xyz');
    expect(init.headers['x-internal-pdf-render']).toMatch(/^[0-9a-f]{64}$/);
    expect(init.signal).toBeDefined();
    expect(mockHtmlToPdf).toHaveBeenCalledOnce();
  });

  it('print page !ok → 500 INTERNAL_ERROR + log con status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 502 })));

    const result = await renderPrintPageToPdf({ request: makeReq(), ...BASE_ARGS });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(500);
    expect(await readJson(result.response)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'No se pudo renderear el informe.',
    });
    expect(mockHtmlToPdf).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      { informeId: 'abc-123', userId: 'u1', consultoraId: 'c1', status: 502 },
      'pdf_route: print page fetch fallo',
    );
  });

  it('internal fetch falla (no abort) → 500 INTERNAL_ERROR + log con err', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await renderPrintPageToPdf({ request: makeReq(), ...BASE_ARGS });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(500);
    expect(await readJson(result.response)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'No se pudo renderear el informe.',
    });
    expect(logger.error).toHaveBeenCalledWith(
      { err: 'Error: ECONNREFUSED', informeId: 'abc-123', userId: 'u1', consultoraId: 'c1' },
      'pdf_route: internal fetch fallo',
    );
  });

  it('abort del hard cap → 504 RENDER_TIMEOUT + log warn', async () => {
    vi.useFakeTimers();
    try {
      // fetch que solo termina cuando el AbortController interno aborta.
      const fetchMock = vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const promise = renderPrintPageToPdf({ request: makeReq(), ...BASE_ARGS });
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.response.status).toBe(504);
      expect(await readJson(result.response)).toEqual({
        code: 'RENDER_TIMEOUT',
        message: 'El PDF tardó demasiado. Reintentá.',
      });
      expect(mockHtmlToPdf).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { informeId: 'abc-123', userId: 'u1', consultoraId: 'c1' },
        'pdf_route: hard cap timeout en internal fetch',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('htmlToPdf lanza PdfRenderTimeoutError → 504 RENDER_TIMEOUT + log con stage', async () => {
    vi.stubGlobal('fetch', okFetch());
    const err = new PdfRenderTimeoutError('pdf', 15_000);
    mockHtmlToPdf.mockRejectedValue(err);

    const result = await renderPrintPageToPdf({ request: makeReq(), ...BASE_ARGS });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(504);
    expect(await readJson(result.response)).toEqual({
      code: 'RENDER_TIMEOUT',
      message: 'El PDF tardó demasiado. Reintentá.',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { informeId: 'abc-123', userId: 'u1', consultoraId: 'c1', stage: err.message },
      'pdf_route: render timeout',
    );
  });

  it('htmlToPdf lanza otro error → 500 INTERNAL_ERROR (mensaje genérico) + log error', async () => {
    vi.stubGlobal('fetch', okFetch());
    mockHtmlToPdf.mockRejectedValue(new Error('chromium crash'));

    const result = await renderPrintPageToPdf({ request: makeReq(), ...BASE_ARGS });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(500);
    expect(await readJson(result.response)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error generando el PDF.',
    });
    expect(logger.error).toHaveBeenCalledWith(
      { err: 'Error: chromium crash', informeId: 'abc-123', userId: 'u1', consultoraId: 'c1' },
      'pdf_route: htmlToPdf fallo',
    );
  });

  it('usa el recurso/logPrefix/logBase propios del caller en el mensaje y el log', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status: 500 })));

    const result = await renderPrintPageToPdf({
      request: makeReq(),
      printPath: '/checklists/ejecuciones/e1/print',
      recurso: 'la inspección',
      logPrefix: 'checklist_pdf_route',
      logBase: { executionId: 'e1', userId: 'u1', consultoraId: 'c1' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(await readJson(result.response)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'No se pudo renderear la inspección.',
    });
    expect(logger.error).toHaveBeenCalledWith(
      { executionId: 'e1', userId: 'u1', consultoraId: 'c1', status: 500 },
      'checklist_pdf_route: print page fetch fallo',
    );
  });
});

describe('pdfDownloadResponse', () => {
  it('setea los headers de descarga (RFC 6266 ascii + filename* UTF-8)', () => {
    const res = pdfDownloadResponse({ pdf: FAKE_PDF, filename: 'informe-ruido-2026-06-14.pdf' });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Length')).toBe(String(FAKE_PDF.length));
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="informe-ruido-2026-06-14.pdf"; filename*=UTF-8\'\'informe-ruido-2026-06-14.pdf',
    );
  });

  it('degrada a "_" los no-ascii en filename y los preserva en filename*', () => {
    const res = pdfDownloadResponse({ pdf: FAKE_PDF, filename: 'inspección-ñ.pdf' });

    const cd = res.headers.get('Content-Disposition')!;
    expect(cd).toContain('filename="inspecci_n-_.pdf"');
    expect(cd).toContain("filename*=UTF-8''inspecci%C3%B3n-%C3%B1.pdf");
  });
});
