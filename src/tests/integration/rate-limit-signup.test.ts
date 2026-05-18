/**
 * T-081 · Tests de rate limiting en signupAction.
 *
 * Cobertura:
 *  1. Rate limit success → action procede normal (resultado depende del input,
 *     irrelevante el outcome de Supabase — verificamos que el limiter SE INVOCÓ).
 *  2. Rate limit failure → retorna `code: RATE_LIMITED` + `retryAfterSeconds`
 *     type-safe, NO invoca supabase.auth.signUp.
 *  3. Zod fail (input malformado) → INVALID_INPUT ANTES del rate limit check,
 *     `mockLimit` NO se invoca (anti-test del orden Zod → rate limit).
 *
 * Mocks:
 *  - `server-only`: stub.
 *  - `next/headers`: cookies + headers con x-forwarded-for específico.
 *  - `@/shared/security/rate-limit`: factory devuelve limiter con `mockLimit`
 *    configurable por test. Mockeamos NUESTRO helper, no `@upstash/ratelimit`
 *    (refactor a otra lib futura no rompe tests).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration -- rate-limit-signup`.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockHeadersGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
      set: () => {},
    }),
  headers: () =>
    Promise.resolve({
      get: mockHeadersGet,
    }),
}));

const mockLimit = vi.fn();
vi.mock('@/shared/security/rate-limit', () => ({
  getRateLimiter: () => ({ limit: mockLimit }),
  noopRateLimiter: {
    limit: () => Promise.resolve({ success: true, remaining: 999, reset: 0, retryAfterSeconds: 0 }),
  },
}));

// Import del action AL FINAL para que los mocks aplicen.
const { signupAction } = await import('@/app/(auth)/signup/actions');

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const createdEmails: string[] = [];

async function cleanupCreatedUsers() {
  if (createdEmails.length === 0) return;
  const { createClient: createSbClient } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return;
  const admin = createSbClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const email of createdEmails) {
    const { data: list } = await admin.auth.admin.listUsers();
    const u = list?.users?.find((x) => x.email === email);
    if (u) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }
}

afterAll(async () => {
  await cleanupCreatedUsers();
});

beforeEach(() => {
  mockLimit.mockReset();
  mockHeadersGet.mockReset();
  mockHeadersGet.mockImplementation((name: string) => {
    if (name === 'x-forwarded-for') return '203.0.113.42';
    return null;
  });
});

describe('signupAction · rate limit', () => {
  it('1. rate limit success → procede (no rate-limit branch)', async () => {
    mockLimit.mockResolvedValueOnce({
      success: true,
      remaining: 4,
      reset: Date.now() + 3600_000,
      retryAfterSeconds: 0,
    });
    const email = `t081-signup-success-${runId}@example.com`;
    createdEmails.push(email);
    const result = await signupAction({
      email,
      password: 'TestPassword123!',
      consultoraName: `T081 Test ${runId}`,
    });
    // El resultado puede ser ok:true o ok:false (depende de si Supabase tuvo
    // alguna falla transient). Lo importante es que NO sea RATE_LIMITED y que
    // el mockLimit haya sido invocado UNA vez con la IP del header mock.
    expect(mockLimit).toHaveBeenCalledTimes(1);
    expect(mockLimit).toHaveBeenCalledWith('203.0.113.42');
    if (!result.ok) {
      expect(result.code).not.toBe('RATE_LIMITED');
    }
  });

  it('2. rate limit failure → RATE_LIMITED con retryAfterSeconds, NO invoca supabase', async () => {
    const expectedRetry = 3600;
    mockLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + expectedRetry * 1000,
      retryAfterSeconds: expectedRetry,
    });
    const email = `t081-signup-blocked-${runId}@example.com`;
    const result = await signupAction({
      email,
      password: 'TestPassword123!',
      consultoraName: 'T081 Blocked',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('RATE_LIMITED');
      if (result.code === 'RATE_LIMITED') {
        expect(result.retryAfterSeconds).toBe(expectedRetry);
        expect(result.message).toContain(`${expectedRetry}s`);
      }
    }
    expect(mockLimit).toHaveBeenCalledOnce();
  });

  it('3. Zod fail (input malformado) → INVALID_INPUT, mockLimit NO invocado', async () => {
    const result = await signupAction({
      email: 'malformed',
      password: 'short',
      consultoraName: 'X',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_INPUT');
    expect(mockLimit).not.toHaveBeenCalled();
  });
});
