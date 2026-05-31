/**
 * T-022.5-FU4 · Tests del redirect URL del GET handler de /auth/callback.
 *
 * Bug productivo: en VPS+EasyPanel detrás de Traefik, el handler usaba
 * `new URL(request.url).origin` y armaba redirects a `0.0.0.0:80` (bind
 * interno del container). Fix: usar `env.NEXT_PUBLIC_SITE_URL` como base.
 *
 * Estos tests verifican que el Location header del redirect apunta al
 * dominio público mockeado, NO al origin del request (que en estos tests
 * es `http://localhost:3000` — exactamente el síntoma que tendría el bug).
 *
 * Estrategia: `vi.mock('@/env', ...)` override del singleton + tests que
 * construyen `NextRequest` con localhost y assertan que el Location apunta
 * a `https://test.example.com/...`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

const MOCK_SITE_URL = 'https://test.example.com';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
      set: () => {},
    }),
}));

// Override del env singleton — el route handler lee env.NEXT_PUBLIC_SITE_URL
// al armar cada redirect. El resto de los campos los completa el SDK desde
// process.env directamente; no hay riesgo de romper el client de supabase.
vi.mock('@/env', async () => {
  const actual = await vi.importActual<typeof import('@/env')>('@/env');
  return {
    ...actual,
    env: {
      ...actual.env,
      NEXT_PUBLIC_SITE_URL: MOCK_SITE_URL,
    },
  };
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const createdUserIds: string[] = [];

async function callGet(query: string, baseOverride?: string) {
  const { GET } = await import('@/app/auth/callback/route');
  const req = new NextRequest(`${baseOverride ?? 'http://localhost:3000'}/auth/callback${query}`);
  return GET(req);
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId).catch(() => {
      // Best-effort.
    });
  }
});

describe('/auth/callback · redirect URL usa NEXT_PUBLIC_SITE_URL (T-022.5-FU4)', () => {
  it('error path sin code ni token_hash → Location absoluto al dominio público', async () => {
    const res = await callGet('');
    expect([302, 307]).toContain(res.status);
    const location = res.headers.get('location');
    expect(location).toBe(`${MOCK_SITE_URL}/login?error=callback_failed`);
  });

  it('error path con code inválido → Location absoluto al dominio público', async () => {
    const res = await callGet('?code=fake-code-not-valid');
    expect([302, 307]).toContain(res.status);
    const location = res.headers.get('location');
    expect(location).toBe(`${MOCK_SITE_URL}/login?error=callback_failed`);
  });

  it('error path con token_hash type inválido → Location absoluto al dominio público', async () => {
    const res = await callGet('?token_hash=x&type=evil_type');
    expect([302, 307]).toContain(res.status);
    const location = res.headers.get('location');
    expect(location).toBe(`${MOCK_SITE_URL}/login?error=callback_failed`);
  });

  it('Location NO contiene el host del request (0.0.0.0 / localhost simulado)', async () => {
    // Simulamos el escenario del bug: request.url tiene un host que NO es el
    // dominio público (acá usamos 0.0.0.0:80 mismo, igual que el container).
    const res = await callGet('', 'http://0.0.0.0:80');
    const location = res.headers.get('location') ?? '';
    expect(location).not.toContain('0.0.0.0');
    expect(location).not.toContain('localhost');
    expect(location.startsWith(MOCK_SITE_URL)).toBe(true);
  });

  it('happy path con token_hash válido + next=/cambiar-password → Location absoluto al dominio público', async () => {
    const email = `t022-5-fu4-callback-redirect-${runId}@example.com`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: 'TestPassword123!',
      email_confirm: true,
    });
    if (createErr || !created.user) throw new Error(`createUser falló: ${createErr?.message}`);
    createdUserIds.push(created.user.id);

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    });
    if (linkErr) throw new Error(`generateLink falló: ${linkErr.message}`);
    const tokenHash = linkData.properties?.hashed_token;
    expect(tokenHash).toBeTruthy();
    if (!tokenHash) return;

    const res = await callGet(
      `?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=/cambiar-password`,
    );

    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('location')).toBe(`${MOCK_SITE_URL}/cambiar-password`);
  });
});

describe('/auth/callback · trailing slash en NEXT_PUBLIC_SITE_URL strippeado', () => {
  // Override local del mock para este describe — re-mockeamos via doMock + resetModules.
  it('NEXT_PUBLIC_SITE_URL con trailing slash → Location sin slash duplicado', async () => {
    vi.resetModules();
    vi.doMock('@/env', async () => {
      const actual = await vi.importActual<typeof import('@/env')>('@/env');
      return {
        ...actual,
        env: {
          ...actual.env,
          NEXT_PUBLIC_SITE_URL: `${MOCK_SITE_URL}/`,
        },
      };
    });

    const { GET } = await import('@/app/auth/callback/route');
    const req = new NextRequest('http://localhost:3000/auth/callback');
    const res = await GET(req);

    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('location')).toBe(`${MOCK_SITE_URL}/login?error=callback_failed`);

    // Restaurar el mock default para que el resto de los tests no vea el slash.
    vi.doUnmock('@/env');
    vi.resetModules();
  });
});
