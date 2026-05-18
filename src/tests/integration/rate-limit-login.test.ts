/**
 * T-081 · Tests de rate limiting multi-dim (IP + email) en loginAction.
 *
 * Cobertura:
 *  1. Ambos limiters OK → procede (no RATE_LIMITED).
 *  2. Solo IP excedido → RATE_LIMITED.
 *  3. Solo email excedido → RATE_LIMITED.
 *  4. Ambos excedidos → RATE_LIMITED con `retryAfterSeconds = max(ip, email)`.
 *
 * Las invocaciones son atomic vía Promise.all en el action — los mocks
 * deben tener `mockResolvedValueOnce` en orden: PRIMERA call es loginIpLimiter,
 * SEGUNDA es loginEmailLimiter (Promise.all preserva orden de args).
 *
 * Mocks:
 *  - `server-only`: stub.
 *  - `next/headers`: cookies + headers stub.
 *  - `@/shared/security/rate-limit`: factory devuelve limiter SHARED — el orden
 *    de invocación lo controlamos con mockResolvedValueOnce calls.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration -- rate-limit-login`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { loginAction } = await import('@/app/(auth)/login/actions');

const TEST_EMAIL = 't081-login@example.com';
const TEST_IP = '203.0.113.50';

beforeEach(() => {
  mockLimit.mockReset();
  mockHeadersGet.mockReset();
  mockHeadersGet.mockImplementation((name: string) => {
    if (name === 'x-forwarded-for') return TEST_IP;
    return null;
  });
});

describe('loginAction · rate limit multi-dim (IP + email)', () => {
  it('1. ambos limiters OK → procede (no RATE_LIMITED)', async () => {
    // Ambas calls success.
    mockLimit.mockResolvedValueOnce({
      success: true,
      remaining: 9,
      reset: Date.now() + 900_000,
      retryAfterSeconds: 0,
    });
    mockLimit.mockResolvedValueOnce({
      success: true,
      remaining: 4,
      reset: Date.now() + 900_000,
      retryAfterSeconds: 0,
    });
    const result = await loginAction({ email: TEST_EMAIL, password: 'wrong-password' });
    // Esperado INVALID_CREDENTIALS (email no existe) o EMAIL_NOT_CONFIRMED o
    // INTERNAL_ERROR — NUNCA RATE_LIMITED. Ambos limiters fueron invocados.
    expect(mockLimit).toHaveBeenCalledTimes(2);
    expect(mockLimit).toHaveBeenNthCalledWith(1, TEST_IP);
    expect(mockLimit).toHaveBeenNthCalledWith(2, TEST_EMAIL);
    if (!result.ok) {
      expect(result.code).not.toBe('RATE_LIMITED');
    }
  });

  it('2. solo IP excedido → RATE_LIMITED con retryAfterSeconds del IP', async () => {
    const ipRetry = 600;
    // Promise.all evalúa ambos. IP fail, email ok.
    mockLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + ipRetry * 1000,
      retryAfterSeconds: ipRetry,
    });
    mockLimit.mockResolvedValueOnce({
      success: true,
      remaining: 4,
      reset: Date.now() + 900_000,
      retryAfterSeconds: 0,
    });
    const result = await loginAction({ email: TEST_EMAIL, password: 'wrong-password' });
    expect(result.ok).toBe(false);
    if (!result.ok && result.code === 'RATE_LIMITED') {
      expect(result.retryAfterSeconds).toBe(ipRetry);
      expect(result.message).toContain(`${ipRetry}s`);
    } else {
      throw new Error(`Esperaba RATE_LIMITED, recibí ${result.ok ? 'ok:true' : result.code}`);
    }
    expect(mockLimit).toHaveBeenCalledTimes(2);
  });

  it('3. solo email excedido → RATE_LIMITED con retryAfterSeconds del email', async () => {
    const emailRetry = 450;
    mockLimit.mockResolvedValueOnce({
      success: true,
      remaining: 9,
      reset: Date.now() + 900_000,
      retryAfterSeconds: 0,
    });
    mockLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + emailRetry * 1000,
      retryAfterSeconds: emailRetry,
    });
    const result = await loginAction({ email: TEST_EMAIL, password: 'wrong-password' });
    expect(result.ok).toBe(false);
    if (!result.ok && result.code === 'RATE_LIMITED') {
      expect(result.retryAfterSeconds).toBe(emailRetry);
    } else {
      throw new Error(`Esperaba RATE_LIMITED, recibí ${result.ok ? 'ok:true' : result.code}`);
    }
  });

  it('4. ambos excedidos → RATE_LIMITED con retryAfterSeconds = max(ip, email)', async () => {
    const ipRetry = 200;
    const emailRetry = 700;
    mockLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + ipRetry * 1000,
      retryAfterSeconds: ipRetry,
    });
    mockLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + emailRetry * 1000,
      retryAfterSeconds: emailRetry,
    });
    const result = await loginAction({ email: TEST_EMAIL, password: 'wrong-password' });
    expect(result.ok).toBe(false);
    if (!result.ok && result.code === 'RATE_LIMITED') {
      expect(result.retryAfterSeconds).toBe(Math.max(ipRetry, emailRetry));
    } else {
      throw new Error(`Esperaba RATE_LIMITED, recibí ${result.ok ? 'ok:true' : result.code}`);
    }
  });
});
