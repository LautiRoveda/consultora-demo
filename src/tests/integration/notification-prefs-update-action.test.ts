/**
 * T-035 · Tests de `updateNotificationPrefsAction`.
 *
 * Cubre:
 *   1. INVALID_INPUT — Zod falla (emailEnabled missing).
 *   2. UNAUTHENTICATED — sin session cookie.
 *   3. Happy path: UPSERT 3 rows (email + telegram + push) + muted_until +7d.
 *   4. RLS cross-user — user A no puede UPDATE prefs de user B (probamos
 *      via side-channel: ownerB submitea + verificamos que sus prefs cambian
 *      sin afectar las de ownerA).
 *   5. Idempotencia — 2 submits consecutivos no duplican rows.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
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
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';

const slugA = `t035-ncp-a-${runId}`;
const slugB = `t035-ncp-b-${runId}`;
const emailUserA = `t035-userA-${runId}@example.com`;
const emailUserB = `t035-userB-${runId}@example.com`;

let cAId: string;
let cBId: string;
let userAId: string;
let userBId: string;

beforeAll(async () => {
  const [{ data: cA }, { data: cB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'T035 ncp cA', slug: slugA }).select('id').single(),
    admin.from('consultoras').insert({ name: 'T035 ncp cB', slug: slugB }).select('id').single(),
  ]);
  cAId = cA!.id;
  cBId = cB!.id;

  const [{ data: uA }, { data: uB }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailUserA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailUserB, password, email_confirm: true }),
  ]);
  userAId = uA.user!.id;
  userBId = uB.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: userAId, consultora_id: cAId, role: 'owner' },
    { user_id: userBId, consultora_id: cBId, role: 'owner' },
  ]);

  await Promise.all([
    admin.auth.admin.updateUserById(userAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(userBId, { app_metadata: { consultora_id: cBId } }),
  ]);
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(userAId).catch(() => {}),
    admin.auth.admin.deleteUser(userBId).catch(() => {}),
  ]);
});

beforeEach(() => {
  cookieStore.length = 0;
});

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

describe('updateNotificationPrefsAction', () => {
  it('1. INVALID_INPUT cuando emailEnabled no es boolean', async () => {
    await signInAs(emailUserA);
    const { updateNotificationPrefsAction } =
      await import('@/app/(app)/settings/notificaciones/actions');
    // Cast intencional: el caller real es RHF + zodResolver que tipa correcto,
    // aca simulamos un payload malformado (string en lugar de boolean).
    const res = await updateNotificationPrefsAction({
      emailEnabled: 'si' as unknown as boolean,
      mute: { type: 'none' },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('INVALID_INPUT');
      expect(res.fieldErrors?.emailEnabled).toBeDefined();
    }
  });

  it('2. UNAUTHENTICATED sin session cookie', async () => {
    // cookieStore vacio (beforeEach lo limpia).
    const { updateNotificationPrefsAction } =
      await import('@/app/(app)/settings/notificaciones/actions');
    const res = await updateNotificationPrefsAction({
      emailEnabled: true,
      mute: { type: 'none' },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('UNAUTHENTICATED');
  });

  it('3. happy path: UPSERT 3 rows con muted_until +7d', async () => {
    await signInAs(emailUserA);
    const { updateNotificationPrefsAction } =
      await import('@/app/(app)/settings/notificaciones/actions');
    const beforeMs = Date.now();
    const res = await updateNotificationPrefsAction({
      emailEnabled: true,
      mute: { type: 'days', days: 7 },
    });
    const afterMs = Date.now();

    expect(res.ok).toBe(true);

    const { data: rows } = await admin
      .from('notification_channel_prefs')
      .select('channel, enabled, muted_until')
      .eq('user_id', userAId);

    expect(rows).toHaveLength(3);
    const byChannel = new Map(rows!.map((r) => [r.channel, r]));

    expect(byChannel.get('email')?.enabled).toBe(true);
    expect(byChannel.get('telegram')?.enabled).toBe(false);
    expect(byChannel.get('push')?.enabled).toBe(false);

    // muted_until ~ now + 7d, tolerance basada en el delta entre antes/despues.
    const expectedMin = beforeMs + 7 * 24 * 60 * 60 * 1000;
    const expectedMax = afterMs + 7 * 24 * 60 * 60 * 1000;
    for (const channel of ['email', 'telegram', 'push'] as const) {
      const mu = byChannel.get(channel)?.muted_until;
      expect(mu).not.toBeNull();
      const muMs = new Date(mu!).getTime();
      expect(muMs).toBeGreaterThanOrEqual(expectedMin);
      expect(muMs).toBeLessThanOrEqual(expectedMax);
    }
  });

  it('4. RLS: userA submit no afecta prefs de userB', async () => {
    // Snapshot prev de userB (debe estar el row email del trigger T-031).
    const { data: bBefore } = await admin
      .from('notification_channel_prefs')
      .select('channel, enabled, muted_until')
      .eq('user_id', userBId);

    // userA submitea con mute=none + emailDisabled.
    await signInAs(emailUserA);
    const { updateNotificationPrefsAction } =
      await import('@/app/(app)/settings/notificaciones/actions');
    const res = await updateNotificationPrefsAction({
      emailEnabled: false,
      mute: { type: 'none' },
    });
    expect(res.ok).toBe(true);

    // Verificar que userB sigue intacto (sigue 1 row email enabled=true).
    const { data: bAfter } = await admin
      .from('notification_channel_prefs')
      .select('channel, enabled, muted_until')
      .eq('user_id', userBId);

    expect(bAfter).toEqual(bBefore);

    // Sanity: userA tiene email enabled=false ahora.
    const { data: aEmail } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userAId)
      .eq('channel', 'email')
      .single();
    expect(aEmail?.enabled).toBe(false);
  });

  it('5. idempotencia: 2 submits consecutivos no duplican rows', async () => {
    await signInAs(emailUserA);
    const { updateNotificationPrefsAction } =
      await import('@/app/(app)/settings/notificaciones/actions');

    const input = {
      emailEnabled: true,
      mute: { type: 'days' as const, days: 14 as const },
    };
    const res1 = await updateNotificationPrefsAction(input);
    expect(res1.ok).toBe(true);
    const res2 = await updateNotificationPrefsAction(input);
    expect(res2.ok).toBe(true);

    const { count } = await admin
      .from('notification_channel_prefs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userAId);

    // Siempre 3 rows (email + telegram + push). El UPSERT con onConflict
    // updatea el row existente sin insertar duplicados.
    expect(count).toBe(3);
  });
});
