/**
 * T-034 · Tests del route handler POST /api/push/subscribe.
 *
 * Cobertura:
 *  1. POST sin sesión → 401 UNAUTHENTICATED.
 *  2. POST body no-JSON → 400 INVALID_JSON.
 *  3. POST body shape inválido (sin endpoint/keys) → 400 INVALID_INPUT.
 *  4. POST happy path → 201 + DB row + UA capturado + pref push enabled=true.
 *  5. POST idempotencia: 2 POSTs mismo endpoint → 1 row (UPSERT).
 *  6. POST re-subscribe en mismo endpoint refresca last_seen_at.
 *  7. POST auto-enable pref incluso si previamente disabled.
 *
 * Mocks:
 *  - server-only stub.
 *  - next/headers cookies stub (patrón canónico T-033).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Import del handler AL FINAL (después de los mocks).
import { POST } from '@/app/api/push/subscribe/route';

vi.mock('server-only', () => ({}));

// cookies() stub para que createClient (server) lea/escriba en este store.
const cookieStore: Array<{ name: string; value: string }> = [];
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
  cookies: () =>
    Promise.resolve({
      getAll: () => cookieStore.map((c) => ({ name: c.name, value: c.value })),
      set: (name: string, value: string) => {
        const idx = cookieStore.findIndex((c) => c.name === name);
        if (idx >= 0) cookieStore[idx] = { name, value };
        else cookieStore.push({ name, value });
      },
    }),
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `t034-sub-${runId}`;
const emailUser = `t034-sub-user-${runId}@example.com`;
const password = 'TestPassword123!';

let cId: string;
let userId: string;

const sessionCache = new Map<string, Array<{ name: string; value: string }>>();
async function signInAs(email: string): Promise<void> {
  cookieStore.length = 0;
  const cached = sessionCache.get(email);
  if (cached) {
    for (const c of cached) cookieStore.push({ ...c });
    return;
  }
  const { createClient: createServerClient } = await import('@/shared/supabase/server');
  const sb = await createServerClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  sessionCache.set(
    email,
    cookieStore.map((c) => ({ ...c })),
  );
}

function makeRequest(opts: { body: unknown; userAgent?: string | null }): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.userAgent !== null && opts.userAgent !== undefined) {
    headers['User-Agent'] = opts.userAgent;
  }
  return new NextRequest('http://localhost/api/push/subscribe', {
    method: 'POST',
    headers,
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
}

function endpoint(suffix: string): string {
  return `https://fcm.googleapis.com/fcm/send/t034-sub-${runId}-${suffix}`;
}

const validBody = (epSuffix: string) => ({
  endpoint: endpoint(epSuffix),
  keys: { p256dh: 'fake-p256dh-key-base64', auth: 'fake-auth-key-base64' },
});

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T034 sub', slug })
    .select('id')
    .single();
  cId = c!.id;

  const { data: u } = await admin.auth.admin.createUser({
    email: emailUser,
    password,
    email_confirm: true,
  });
  userId = u.user!.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: userId, consultora_id: cId, role: 'owner' });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userId).catch(() => {});
});

beforeEach(async () => {
  cookieStore.length = 0;
  await admin.from('push_subscriptions').delete().eq('user_id', userId);
  await admin
    .from('notification_channel_prefs')
    .delete()
    .eq('user_id', userId)
    .eq('channel', 'push');
});

describe('POST /api/push/subscribe', () => {
  it('1. sin sesión → 401 UNAUTHENTICATED', async () => {
    const req = makeRequest({ body: validBody('S1') });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { ok: false; code: string };
    expect(json.code).toBe('UNAUTHENTICATED');
  });

  it('2. body no-JSON → 400 INVALID_JSON', async () => {
    await signInAs(emailUser);
    const req = makeRequest({ body: 'not-json{{{' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: false; code: string };
    expect(json.code).toBe('INVALID_JSON');
  });

  it('3. body shape inválido (sin keys) → 400 INVALID_INPUT', async () => {
    await signInAs(emailUser);
    const req = makeRequest({ body: { endpoint: endpoint('S3') } });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: false; code: string; issues: string[] };
    expect(json.code).toBe('INVALID_INPUT');
    expect(json.issues.length).toBeGreaterThan(0);
  });

  it('4. happy path → 201 + DB row + UA capturado + pref push enabled=true', async () => {
    await signInAs(emailUser);
    const req = makeRequest({
      body: validBody('S4'),
      userAgent: 'Mozilla/5.0 (Test) Chrome/120',
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: true; subscriptionId: string };
    expect(json.ok).toBe(true);
    expect(json.subscriptionId).toMatch(/^[0-9a-f-]{36}$/);

    // DB row verify.
    const { data: sub } = await admin
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh_key, auth_key, user_agent')
      .eq('id', json.subscriptionId)
      .single();
    expect(sub?.user_id).toBe(userId);
    expect(sub?.endpoint).toBe(endpoint('S4'));
    expect(sub?.p256dh_key).toBe('fake-p256dh-key-base64');
    expect(sub?.auth_key).toBe('fake-auth-key-base64');
    expect(sub?.user_agent).toBe('Mozilla/5.0 (Test) Chrome/120');

    // Pref auto-enabled (Q2 cerrada).
    const { data: pref } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userId)
      .eq('channel', 'push')
      .single();
    expect(pref?.enabled).toBe(true);
  });

  it('5. idempotencia: 2 POSTs mismo endpoint → 1 row (UPSERT)', async () => {
    await signInAs(emailUser);
    const ep = endpoint('IDEM');
    const body = { endpoint: ep, keys: { p256dh: 'k1', auth: 'a1' } };

    const r1 = await POST(makeRequest({ body }));
    expect(r1.status).toBe(201);

    const r2 = await POST(makeRequest({ body }));
    expect(r2.status).toBe(201);

    const { count } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('endpoint', ep);
    expect(count).toBe(1);
  });

  it('6. re-subscribe en mismo endpoint refresca last_seen_at + keys', async () => {
    await signInAs(emailUser);
    const ep = endpoint('REFR');

    // 1er subscribe.
    const r1 = await POST(
      makeRequest({ body: { endpoint: ep, keys: { p256dh: 'k1', auth: 'a1' } } }),
    );
    expect(r1.status).toBe(201);
    const { data: before } = await admin
      .from('push_subscriptions')
      .select('last_seen_at, p256dh_key')
      .eq('user_id', userId)
      .eq('endpoint', ep)
      .single();

    // 2do subscribe con keys distintas (browser puede regenerar).
    const r2 = await POST(
      makeRequest({ body: { endpoint: ep, keys: { p256dh: 'k2', auth: 'a2' } } }),
    );
    expect(r2.status).toBe(201);

    const { data: after } = await admin
      .from('push_subscriptions')
      .select('last_seen_at, p256dh_key')
      .eq('user_id', userId)
      .eq('endpoint', ep)
      .single();

    expect(after?.p256dh_key).toBe('k2');
    expect(after?.last_seen_at).not.toBe(before?.last_seen_at);
  });

  it('7. auto-enable pref incluso si previamente disabled', async () => {
    await signInAs(emailUser);
    // Setup: pref previamente disabled (user unsubscribed antes).
    await admin
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userId, channel: 'push', enabled: false },
        { onConflict: 'user_id,channel' },
      );

    const r = await POST(makeRequest({ body: validBody('S7') }));
    expect(r.status).toBe(201);

    const { data: pref } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userId)
      .eq('channel', 'push')
      .single();
    expect(pref?.enabled).toBe(true);
  });
});
