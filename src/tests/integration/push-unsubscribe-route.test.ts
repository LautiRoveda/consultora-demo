/**
 * T-034 · Tests del route handler DELETE /api/push/unsubscribe.
 *
 * Cobertura:
 *  1. DELETE sin sesión → 401 UNAUTHENTICATED.
 *  2. DELETE body no-JSON → 400 INVALID_JSON.
 *  3. DELETE body sin endpoint → 400 INVALID_INPUT.
 *  4. DELETE happy path: borra row + auto-disable pref si era última sub.
 *  5. DELETE con otras subs en otros devices → preserva pref enabled.
 *  6. DELETE endpoint inexistente → 200 idempotente (0 rows).
 *  7. Cross-user: DELETE endpoint de otro user → 200 con 0 rows.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE } from '@/app/api/push/unsubscribe/route';

vi.mock('server-only', () => ({}));

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
  throw new Error('Tests requieren env vars Supabase. Correr con `pnpm test:integration`.');
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `t034-uns-${runId}`;
const emailUserA = `t034-uns-userA-${runId}@example.com`;
const emailUserB = `t034-uns-userB-${runId}@example.com`;
const password = 'TestPassword123!';

let cId: string;
let userAId: string;
let userBId: string;

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

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/push/unsubscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function endpoint(suffix: string): string {
  return `https://fcm.googleapis.com/fcm/send/t034-uns-${runId}-${suffix}`;
}

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T034 uns', slug })
    .select('id')
    .single();
  cId = c!.id;

  const [{ data: uA }, { data: uB }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailUserA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailUserB, password, email_confirm: true }),
  ]);
  userAId = uA.user!.id;
  userBId = uB.user!.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: userAId, consultora_id: cId, role: 'owner' });
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(userAId).catch(() => {}),
    admin.auth.admin.deleteUser(userBId).catch(() => {}),
  ]);
});

beforeEach(async () => {
  cookieStore.length = 0;
  await admin.from('push_subscriptions').delete().in('user_id', [userAId, userBId]);
  await admin
    .from('notification_channel_prefs')
    .delete()
    .in('user_id', [userAId, userBId])
    .eq('channel', 'push');
});

describe('DELETE /api/push/unsubscribe', () => {
  it('1. sin sesión → 401', async () => {
    const r = await DELETE(makeRequest({ endpoint: endpoint('U1') }));
    expect(r.status).toBe(401);
    const json = (await r.json()) as { code: string };
    expect(json.code).toBe('UNAUTHENTICATED');
  });

  it('2. body no-JSON → 400 INVALID_JSON', async () => {
    await signInAs(emailUserA);
    const r = await DELETE(makeRequest('not-json{{{'));
    expect(r.status).toBe(400);
    const json = (await r.json()) as { code: string };
    expect(json.code).toBe('INVALID_JSON');
  });

  it('3. body sin endpoint → 400 INVALID_INPUT', async () => {
    await signInAs(emailUserA);
    const r = await DELETE(makeRequest({}));
    expect(r.status).toBe(400);
    const json = (await r.json()) as { code: string };
    expect(json.code).toBe('INVALID_INPUT');
  });

  it('4. happy path: única sub → DELETE + auto-disable pref', async () => {
    await signInAs(emailUserA);
    // Setup: 1 sub + pref enabled.
    await admin.from('push_subscriptions').insert({
      user_id: userAId,
      endpoint: endpoint('U4'),
      p256dh_key: 'k',
      auth_key: 'a',
    });
    await admin
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userAId, channel: 'push', enabled: true },
        { onConflict: 'user_id,channel' },
      );

    const r = await DELETE(makeRequest({ endpoint: endpoint('U4') }));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { ok: true; deletedCount: number };
    expect(json.deletedCount).toBe(1);

    // Row borrada.
    const { count } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userAId);
    expect(count).toBe(0);

    // Pref auto-disabled.
    const { data: pref } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userAId)
      .eq('channel', 'push')
      .single();
    expect(pref?.enabled).toBe(false);
  });

  it('5. otras subs en otros devices → preserva pref enabled', async () => {
    await signInAs(emailUserA);
    // Setup: 2 subs (multi-device) + pref enabled.
    await admin.from('push_subscriptions').insert([
      {
        user_id: userAId,
        endpoint: endpoint('U5-dev1'),
        p256dh_key: 'k1',
        auth_key: 'a1',
      },
      {
        user_id: userAId,
        endpoint: endpoint('U5-dev2'),
        p256dh_key: 'k2',
        auth_key: 'a2',
      },
    ]);
    await admin
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userAId, channel: 'push', enabled: true },
        { onConflict: 'user_id,channel' },
      );

    // Unsubscribe SOLO dev1.
    const r = await DELETE(makeRequest({ endpoint: endpoint('U5-dev1') }));
    expect(r.status).toBe(200);

    // Dev2 sigue.
    const { count } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userAId);
    expect(count).toBe(1);

    // Pref preserva enabled.
    const { data: pref } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userAId)
      .eq('channel', 'push')
      .single();
    expect(pref?.enabled).toBe(true);
  });

  it('6. endpoint inexistente → 200 idempotente (0 rows)', async () => {
    await signInAs(emailUserA);
    const r = await DELETE(makeRequest({ endpoint: endpoint('NOTFOUND') }));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { deletedCount: number };
    expect(json.deletedCount).toBe(0);
  });

  it('7. cross-user: DELETE endpoint de otro user → 200 con 0 rows', async () => {
    // userB tiene una sub. userA intenta borrarla.
    await admin.from('push_subscriptions').insert({
      user_id: userBId,
      endpoint: endpoint('U7-userB'),
      p256dh_key: 'k',
      auth_key: 'a',
    });

    await signInAs(emailUserA);
    const r = await DELETE(makeRequest({ endpoint: endpoint('U7-userB') }));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { deletedCount: number };
    expect(json.deletedCount).toBe(0);

    // Sub de userB sigue intacta.
    const { count } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userBId)
      .eq('endpoint', endpoint('U7-userB'));
    expect(count).toBe(1);
  });
});
