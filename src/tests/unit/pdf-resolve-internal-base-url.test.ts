/**
 * T-023-FU2 · Unit tests del helper `resolveInternalBaseUrl`.
 *
 * Cubre los 4 paths del helper + edge case de string vacio:
 *  1. INTERNAL_BASE_URL truthy override prevalece sobre NODE_ENV.
 *  2. INTERNAL_BASE_URL con trailing slash → strip.
 *  3. INTERNAL_BASE_URL="" (string vacio) → cae al next case por falsy guard.
 *  4. NODE_ENV=production sin override → http://127.0.0.1:3000 (PORT default).
 *  5. NODE_ENV=production sin override + PORT=8080 → http://127.0.0.1:8080.
 *  6. NODE_ENV=development sin override → request.url origin.
 *  7. NODE_ENV no-prod + request.url malformado → throw con mensaje claro.
 *
 * Aislamiento: `vi.stubEnv` para mutar env vars typesafe (NODE_ENV es
 * readonly en TS strict con @types/node 22+). `vi.unstubAllEnvs()` en
 * afterEach restaura al baseline original — evita leak entre tests.
 *
 * Mock de `server-only`: el helper hace `import 'server-only'`; en el environment
 * node de vitest unit project esto explota porque server-only chequea
 * Webpack/Turbopack barrel. Stub no-op idéntico al patrón de otros tests del repo.
 *
 * Correr local: `pnpm test`.
 */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveInternalBaseUrl } from '@/shared/lib/resolve-internal-base-url';

vi.mock('server-only', () => ({}));

function makeReq(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

describe('resolveInternalBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('1. INTERNAL_BASE_URL truthy override prevalece sobre NODE_ENV=production', () => {
    vi.stubEnv('INTERNAL_BASE_URL', 'http://override:8080');
    vi.stubEnv('NODE_ENV', 'production');
    const result = resolveInternalBaseUrl(makeReq('https://anywhere.example.com/api/x'));
    expect(result).toBe('http://override:8080');
  });

  it('2. INTERNAL_BASE_URL con trailing slash → strip', () => {
    vi.stubEnv('INTERNAL_BASE_URL', 'http://override:8080/');
    vi.stubEnv('NODE_ENV', 'production');
    const result = resolveInternalBaseUrl(makeReq('https://anywhere.example.com/api/x'));
    expect(result).toBe('http://override:8080');
  });

  it('3. INTERNAL_BASE_URL="" (string vacio) cae al next case por falsy guard', () => {
    vi.stubEnv('INTERNAL_BASE_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    const result = resolveInternalBaseUrl(makeReq('https://anywhere.example.com/api/x'));
    // Cae al loopback IPv4 porque "" es falsy — NO se interpreta como override
    // con valor vacio (que daria una URL malformada `://path`).
    expect(result).toBe('http://127.0.0.1:3000');
  });

  it('4. NODE_ENV=production sin override → http://127.0.0.1:3000 (PORT default)', () => {
    vi.stubEnv('INTERNAL_BASE_URL', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PORT', undefined);
    const result = resolveInternalBaseUrl(makeReq('https://consultora-demo.test-ia.cloud/api/x'));
    expect(result).toBe('http://127.0.0.1:3000');
  });

  it('5. NODE_ENV=production sin override + PORT=8080 → http://127.0.0.1:8080', () => {
    vi.stubEnv('INTERNAL_BASE_URL', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PORT', '8080');
    const result = resolveInternalBaseUrl(makeReq('https://consultora-demo.test-ia.cloud/api/x'));
    expect(result).toBe('http://127.0.0.1:8080');
  });

  it('6. NODE_ENV=development sin override → request.url origin', () => {
    vi.stubEnv('INTERNAL_BASE_URL', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    const result = resolveInternalBaseUrl(makeReq('http://localhost:3000/api/informes/abc/pdf'));
    expect(result).toBe('http://localhost:3000');
  });

  it('7. NODE_ENV=test + request.url malformado → throw con mensaje claro', () => {
    vi.stubEnv('INTERNAL_BASE_URL', undefined);
    vi.stubEnv('NODE_ENV', 'test');
    // Forzamos un request.url invalido inyectandolo via getter — NextRequest
    // normalmente no permite construirlo malformado, pero stubeamos para
    // simular el edge case que dispara el throw.
    const req = makeReq('http://localhost:3000/api/x');
    Object.defineProperty(req, 'url', {
      get: () => 'not-a-valid-url',
      configurable: true,
    });

    expect(() => resolveInternalBaseUrl(req)).toThrow(/resolveInternalBaseUrl/);
    expect(() => resolveInternalBaseUrl(req)).toThrow(/NODE_ENV=test/);
    expect(() => resolveInternalBaseUrl(req)).toThrow(/INTERNAL_BASE_URL/);
  });
});
