/**
 * T-014 · Tests del GET handler de /auth/callback.
 *
 * Cubre los 2 shapes que Supabase puede emitir + casos de error:
 * - `?code=`         → PKCE flow (exchangeCodeForSession)
 * - `?token_hash=&type=` → OTP flow (verifyOtp)
 * - Sin code ni token_hash → bounce a /login?error=callback_failed
 * - `?token_hash=` sin `type` válido → bounce
 *
 * Estrategia: importar `GET` directo del route handler, mockear `next/headers`
 * y `server-only` (mismo patrón que tests de actions T-012/T-013/T-014), y
 * construir `NextRequest` manualmente para invocar el handler.
 *
 * El happy path con token_hash válido usa `admin.auth.admin.generateLink` para
 * obtener un `hashed_token` real consumible por `verifyOtp` — bypasea el rate
 * limit de email.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
      set: () => {},
    }),
}));

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

async function callGet(query: string) {
  const { GET } = await import('@/app/auth/callback/route');
  const req = new NextRequest(`http://localhost:3000/auth/callback${query}`);
  return GET(req);
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId).catch(() => {
      // Best-effort.
    });
  }
});

describe('/auth/callback · guards', () => {
  it('sin code ni token_hash → 307 a /login?error=callback_failed', async () => {
    const res = await callGet('');
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('location')).toMatch(/\/login\?error=callback_failed$/);
  });

  it('?code=fake (PKCE inválido) → 307 a /login?error=callback_failed', async () => {
    const res = await callGet('?code=fake-code-not-valid');
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('location')).toMatch(/\/login\?error=callback_failed$/);
  });

  it('?token_hash=fake&type=recovery → 307 a /login?error=callback_failed', async () => {
    const res = await callGet('?token_hash=fake-hash-not-valid&type=recovery');
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('location')).toMatch(/\/login\?error=callback_failed$/);
  });

  it('?token_hash=x&type=invalid → 307 a /login?error=callback_failed (type fuera de allowlist)', async () => {
    const res = await callGet('?token_hash=x&type=evil_type');
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('location')).toMatch(/\/login\?error=callback_failed$/);
  });

  it('?token_hash=x sin type → 307 a /login?error=callback_failed', async () => {
    const res = await callGet('?token_hash=x');
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('location')).toMatch(/\/login\?error=callback_failed$/);
  });
});

describe('/auth/callback · happy path con token_hash válido', () => {
  it('token_hash recovery válido + next=/cambiar-password → 307 a /cambiar-password', async () => {
    // Setup: crear user pre-confirmado.
    const email = `t014-callback-test-${runId}@example.com`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: 'TestPassword123!',
      email_confirm: true,
    });
    if (createErr || !created.user) throw new Error(`createUser falló: ${createErr?.message}`);
    createdUserIds.push(created.user.id);

    // Generar hashed_token real de tipo recovery.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    });
    if (linkErr) throw new Error(`generateLink falló: ${linkErr.message}`);
    const tokenHash = linkData.properties?.hashed_token;
    expect(tokenHash).toBeTruthy();
    if (!tokenHash) return;

    // Invocar el handler con el token real.
    const res = await callGet(
      `?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=/cambiar-password`,
    );

    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('location')).toMatch(/\/cambiar-password$/);
  });
});
