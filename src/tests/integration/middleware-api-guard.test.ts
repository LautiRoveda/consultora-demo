/**
 * C7 audit · Tests del defense-in-depth guard en updateSession.
 *
 * Cobertura:
 *  1. POST /api/informes/<uuid>/pdf sin cookie → 401 con code: UNAUTHENTICATED.
 *  2. POST /api/webhooks/telegram sin cookie → NO 401 del middleware
 *     (prefix whitelist hit). Sigue al handler.
 *  3. GET /api/health sin cookie → NO 401 del middleware (prefix whitelist hit).
 *  4. GET /api/calendar/dispatch-reminder sin cookie → NO 401 del middleware
 *     (path exacto whitelist hit). El handler valida su propio secret.
 *  5. POST /api/calendar/eventos-fake sin cookie → 401 del middleware
 *     (regression guard: exact-path whitelist NO cubre otras routes bajo
 *     /api/calendar/*).
 *  6. Page route (/, /dashboard, etc.) sin cookie → NO 401 (guard solo aplica
 *     a /api/*).
 *
 * Estrategia: invocamos `updateSession(request)` directamente con NextRequest
 * mock. Mockeamos `@supabase/ssr` createServerClient para devolver un user
 * controlable.
 *
 * Correr: `pnpm test:integration -- middleware-api-guard`.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://hoisted.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'hoisted-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'hoisted-service-role-key';
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://hoisted@o0.ingest.sentry.io/0';
  process.env.SENTRY_ORG = 'hoisted-org';
  process.env.SENTRY_PROJECT = 'hoisted-project';
  process.env.ANTHROPIC_API_KEY = 'hoisted-anthropic-key';
  process.env.RESEND_API_KEY = 'hoisted-resend-key';
  process.env.RESEND_FROM_ADDRESS = 'hoisted@example.com';
  process.env.INTERNAL_CRON_SECRET = 'hoisted-cron-secret-32-chars-min-aaa';
  process.env.TELEGRAM_BOT_TOKEN = 'hoisted-tg-token-40-chars-min-aaaaaaaaaaaaaaaa';
  process.env.TELEGRAM_BOT_USERNAME = 'hoisted_bot';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hoisted-tg-webhook-secret-32-chars-aaaa';
  process.env.VAPID_PRIVATE_KEY = 'hoisted-vapid-private-key-44-chars-b64url-aaa';
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY =
    'hoisted-vapid-public-key-88-chars-b64url-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  process.env.ARS_PRICE_MONTHLY = '3000000';
  process.env.MP_ACCESS_TOKEN = 'hoisted-mp-access-token-40-chars-minimum-aaaaa';
  process.env.MP_WEBHOOK_SECRET = 'hoisted-mp-webhook-secret-32-chars-aaaaa';
});

let mockUser: { id: string } | null = null;

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockUser }, error: null }),
    },
  }),
}));

const { updateSession } = await import('@/shared/supabase/middleware');

function makeReq(path: string, method = 'GET'): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method });
}

beforeEach(() => {
  mockUser = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateSession · C7 API guard', () => {
  it('1. POST /api/informes/<uuid>/pdf sin cookie → 401 UNAUTHENTICATED', async () => {
    const req = makeReq('/api/informes/00000000-0000-0000-0000-000000000000/pdf', 'POST');
    const res = await updateSession(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string; message?: string };
    expect(body.code).toBe('UNAUTHENTICATED');
    expect(body.message).toMatch(/iniciá|inicia|sesión|sesion/i);
  });

  it('2. POST /api/webhooks/telegram sin cookie → NO 401 (prefix whitelist)', async () => {
    const req = makeReq('/api/webhooks/telegram', 'POST');
    const res = await updateSession(req);
    // 200/passthrough — el middleware NO bloqueó, el handler decidirá.
    expect(res.status).not.toBe(401);
  });

  it('3. GET /api/health sin cookie → NO 401 (prefix whitelist)', async () => {
    const req = makeReq('/api/health');
    const res = await updateSession(req);
    expect(res.status).not.toBe(401);
  });

  it('4. GET /api/calendar/dispatch-reminder sin cookie → NO 401 (path exacto whitelist)', async () => {
    const req = makeReq('/api/calendar/dispatch-reminder', 'POST');
    const res = await updateSession(req);
    expect(res.status).not.toBe(401);
  });

  it('5. POST /api/calendar/eventos-fake sin cookie → 401 (regression guard, no whitelist match)', async () => {
    const req = makeReq('/api/calendar/eventos-fake', 'POST');
    const res = await updateSession(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('6. GET / (page route, no /api/) sin cookie → NO 401 (guard solo aplica a /api/)', async () => {
    const req = makeReq('/');
    const res = await updateSession(req);
    expect(res.status).not.toBe(401);
  });

  it('7. POST /api/informes/<uuid>/pdf CON user → NO 401 (guard pasa, handler decide)', async () => {
    mockUser = { id: 'usr_test' };
    const req = makeReq('/api/informes/00000000-0000-0000-0000-000000000000/pdf', 'POST');
    const res = await updateSession(req);
    expect(res.status).not.toBe(401);
  });
});
