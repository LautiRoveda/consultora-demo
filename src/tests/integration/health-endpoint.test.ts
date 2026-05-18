/**
 * T-081 · Tests del endpoint GET /api/health.
 *
 * Cobertura:
 *  1. Supabase OK → 200 + shape mínimo (anti-test: NO debe haber fields extra).
 *  2. Supabase error → 503 + supabase: 'down'.
 *  3. Supabase timeout (AbortError) → 503 + supabase: 'down'.
 *  4. Headers: Cache-Control no-store + X-Robots-Tag noindex.
 *
 * Mocks:
 *  - `server-only`: stub.
 *  - `@/shared/supabase/service-role`: stub configurable per test que retorna
 *    distintos shapes de error en el .abortSignal().
 *
 * Anti-test del shape mínimo (test 1): `Object.keys.sort().toEqual([...])`
 * fail si alguien suma un field nuevo sin pensarlo. Forza la conversación
 * "¿realmente necesitamos exponer esto en /api/health?" en el PR review.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration -- health-endpoint`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockAbortSignal = vi.fn();

// Builder devuelve chain de queries .from().select().limit().abortSignal()
function buildSupabaseChain(abortResult: { error: { message: string } | null } | Promise<never>) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        limit: vi.fn(() => ({
          abortSignal: vi.fn(() => {
            mockAbortSignal();
            return abortResult;
          }),
        })),
      })),
    })),
  };
}

let mockAdminClient: ReturnType<typeof buildSupabaseChain> = buildSupabaseChain({ error: null });

vi.mock('@/shared/supabase/service-role', () => ({
  createServiceRoleClient: () => mockAdminClient,
}));

const { GET } = await import('@/app/api/health/route');

beforeEach(() => {
  mockAbortSignal.mockReset();
  mockAdminClient = buildSupabaseChain({ error: null });
});

describe('GET /api/health', () => {
  it('1. supabase ok → 200 + shape MÍNIMO (anti-test contra fields extra)', async () => {
    mockAdminClient = buildSupabaseChain({ error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // Anti-test del shape mínimo: EXACTAMENTE estas 5 keys, nada más, nada menos.
    expect(Object.keys(body).sort()).toEqual([
      'ok',
      'supabase',
      'timestamp',
      'uptime_seconds',
      'version',
    ]);

    expect(body.ok).toBe(true);
    expect(body.supabase).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime_seconds).toBe('number');
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(typeof body.timestamp).toBe('string');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mockAbortSignal).toHaveBeenCalledOnce();
  });

  it('2. supabase devuelve error → 503 + supabase: down + ok: false', async () => {
    mockAdminClient = buildSupabaseChain({
      error: { message: 'Postgres connection refused' },
    });
    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; supabase: string };
    expect(body.ok).toBe(false);
    expect(body.supabase).toBe('down');
  });

  it('3. supabase throw (AbortError simulated) → 503 + supabase: down', async () => {
    // El chain tira durante abortSignal — simula timeout AbortError.
    const abortError = new DOMException('Aborted', 'AbortError');
    mockAdminClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => ({
            abortSignal: vi.fn(() => {
              mockAbortSignal();
              return Promise.reject(abortError);
            }),
          })),
        })),
      })),
    };

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; supabase: string };
    expect(body.ok).toBe(false);
    expect(body.supabase).toBe('down');
  });

  it('4. headers correctos: Cache-Control no-store + X-Robots-Tag noindex', async () => {
    mockAdminClient = buildSupabaseChain({ error: null });
    const res = await GET();
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
  });
});
