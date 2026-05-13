import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/shared/observability/logger';
import { injectBaseHref } from '@/shared/pdf/inject-base-href';

// El helper hace `import 'server-only'`; en el environment node de vitest
// unit project explota sin stub. Patrón canónico del repo (mismo en
// pdf-resolve-internal-base-url.test.ts).
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('injectBaseHref', () => {
  it('happy path: inyecta <base href> como primer hijo del <head>', () => {
    const html =
      '<!DOCTYPE html><html lang="es"><head><meta charSet="utf-8"/><title>x</title></head><body><p>hi</p></body></html>';
    const out = injectBaseHref(html, 'http://127.0.0.1:3000');
    expect(out).toContain('<head><base href="http://127.0.0.1:3000/"/><meta charSet="utf-8"/>');
    // El resto del documento permanece intacto.
    expect(out).toContain('<title>x</title>');
    expect(out).toContain('<body><p>hi</p></body>');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('strippea trailing slash del baseUrl para evitar // doble en href', () => {
    const html = '<html><head></head><body></body></html>';
    const out = injectBaseHref(html, 'http://127.0.0.1:3000/');
    expect(out).toContain('<base href="http://127.0.0.1:3000/"/>');
    expect(out).not.toContain('//"/>');
  });

  it('html sin <head>: retorna sin cambios + logger.warn', () => {
    const html = '<!DOCTYPE html><html><body><p>orphan</p></body></html>';
    const out = injectBaseHref(html, 'http://127.0.0.1:3000');
    expect(out).toBe(html);
    expect(logger.warn).toHaveBeenCalledWith(
      { baseUrl: 'http://127.0.0.1:3000' },
      'inject_base_href: html sin <head>, sin cambios',
    );
  });
});
