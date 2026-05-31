/**
 * T-033 · Tests de los server actions telegram-actions.ts.
 *
 * Cobertura:
 *  1. generateTelegramLinkCodeAction sin sesión → UNAUTHENTICATED.
 *  2. generateTelegramLinkCodeAction happy → 8-char code + deep-link + expiresAt +15min.
 *  3. generateTelegramLinkCodeAction regenera limpio (sobrescribe estado previo).
 *  4. unlinkTelegramAction sin sesión → UNAUTHENTICATED.
 *  5. unlinkTelegramAction sin sub → ok=true (idempotente).
 *  6. unlinkTelegramAction con sub linkeada → DB UPDATE + UPSERT prefs disabled
 *     + bot.sendMessage llamado.
 *  7. unlinkTelegramAction con sub ya unlinked → ok=true (idempotente).
 *
 * Mocks:
 *  - server-only: stub.
 *  - next/headers: stub (cookies()).
 *  - @/shared/telegram/bot-client: sendMessage mockeado.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockSendMessage = vi.fn();
vi.mock('@/shared/telegram/bot-client', () => ({
  getTelegramBotClient: () => ({
    sendMessage: mockSendMessage,
    setWebhook: vi.fn(),
    getMe: vi.fn(),
  }),
}));

// Stub de next/headers — el server action usa cookies() via createClient.
// Patrón canónico de T-035: cookieStore mutable + signInAs que usa
// createServerClient (que respeta este mock) para hidratar cookies con la
// sesión real, después cacheamos las cookies por email para reuso.
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

// Stub revalidatePath — no-op en tests.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
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
const slug = `t033-act-${runId}`;
const emailUser = `t033-act-user-${runId}@example.com`;
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

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T033 ACT', slug })
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
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue({ ok: true, messageId: 999 });
  cookieStore.length = 0;
  await admin.from('telegram_subscriptions').delete().eq('user_id', userId);
});

describe('generateTelegramLinkCodeAction', () => {
  it('1. sin sesión → UNAUTHENTICATED', async () => {
    // sin auth cookie (beforeEach lo limpia)
    const { generateTelegramLinkCodeAction } =
      await import('@/app/(app)/settings/notificaciones/telegram-actions');
    const res = await generateTelegramLinkCodeAction();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('UNAUTHENTICATED');
    }
  });

  it('2. happy path: code 8 chars + deep-link válido + expiresAt +15min + DB row', async () => {
    await signInAs(emailUser);
    const { generateTelegramLinkCodeAction } =
      await import('@/app/(app)/settings/notificaciones/telegram-actions');

    const beforeMs = Date.now();
    const res = await generateTelegramLinkCodeAction();
    const afterMs = Date.now();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
      expect(res.deepLink).toMatch(
        /^https:\/\/t\.me\/[a-zA-Z0-9_]+\?start=[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/,
      );
      const expiresMs = new Date(res.expiresAt).getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(beforeMs + 14 * 60_000);
      expect(expiresMs).toBeLessThanOrEqual(afterMs + 16 * 60_000);
    }

    // Verificar DB.
    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('link_code, link_code_expires_at, linked_at, unlinked_at, blocked_count')
      .eq('user_id', userId)
      .single();
    expect(sub?.link_code).toBeTruthy();
    expect(sub?.link_code_expires_at).toBeTruthy();
    expect(sub?.linked_at).toBeNull();
    expect(sub?.unlinked_at).toBeNull();
    expect(sub?.blocked_count).toBe(0);
  });

  it('3. regenera limpio: segunda llamada sobrescribe estado previo', async () => {
    await signInAs(emailUser);
    const { generateTelegramLinkCodeAction } =
      await import('@/app/(app)/settings/notificaciones/telegram-actions');

    const first = await generateTelegramLinkCodeAction();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simular estado linkeado intermedio (como si user hubiera completado
    // el /start pero después regenera código por alguna razón).
    await admin
      .from('telegram_subscriptions')
      .update({
        telegram_chat_id: 12345,
        telegram_username: 'oldname',
        linked_at: new Date().toISOString(),
        link_code: null,
        unlinked_at: null,
        blocked_count: 2,
      })
      .eq('user_id', userId);

    const second = await generateTelegramLinkCodeAction();
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.code).not.toBe(first.code);

    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select(
        'link_code, link_code_expires_at, linked_at, unlinked_at, telegram_chat_id, blocked_count',
      )
      .eq('user_id', userId)
      .single();
    expect(sub?.link_code).toBe(second.code);
    expect(sub?.linked_at).toBeNull(); // reset al regenerar
    expect(sub?.telegram_chat_id).toBeNull(); // reset
    expect(sub?.blocked_count).toBe(0); // reset
  });
});

describe('unlinkTelegramAction', () => {
  it('4. sin sesión → UNAUTHENTICATED', async () => {
    // cookieStore vacio (beforeEach lo limpia);
    const { unlinkTelegramAction } =
      await import('@/app/(app)/settings/notificaciones/telegram-actions');
    const res = await unlinkTelegramAction();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('UNAUTHENTICATED');
    }
  });

  it('5. sin sub → ok=true (idempotente)', async () => {
    await signInAs(emailUser);
    const { unlinkTelegramAction } =
      await import('@/app/(app)/settings/notificaciones/telegram-actions');
    const res = await unlinkTelegramAction();
    expect(res.ok).toBe(true);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('6. con sub linkeada → DB UPDATE unlinked_at + prefs disabled + sendMessage', async () => {
    await signInAs(emailUser);

    // Setup: subscription linkeada + pref enabled.
    const chatId = 7_000_006;
    await admin.from('telegram_subscriptions').insert({
      user_id: userId,
      telegram_chat_id: chatId,
      linked_at: new Date().toISOString(),
    });
    await admin
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userId, channel: 'telegram', enabled: true },
        { onConflict: 'user_id,channel' },
      );

    const { unlinkTelegramAction } =
      await import('@/app/(app)/settings/notificaciones/telegram-actions');
    const res = await unlinkTelegramAction();
    expect(res.ok).toBe(true);

    // sendMessage llamado con chatId + texto desvincular.
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockSendMessage.mock.calls[0]![0]).toBe(chatId);
    expect(mockSendMessage.mock.calls[0]![1]).toMatch(/desvinculaste/i);

    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('unlinked_at, telegram_chat_id')
      .eq('user_id', userId)
      .single();
    expect(sub?.unlinked_at).toBeTruthy();
    expect(sub?.telegram_chat_id).toBeNull();

    const { data: pref } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userId)
      .eq('channel', 'telegram')
      .single();
    expect(pref?.enabled).toBe(false);
  });

  it('7. con sub ya unlinked → ok=true (idempotente, sin sendMessage)', async () => {
    await signInAs(emailUser);

    // Setup: subscription ya unlinked.
    await admin.from('telegram_subscriptions').insert({
      user_id: userId,
      telegram_chat_id: null,
      linked_at: new Date(Date.now() - 86_400_000).toISOString(),
      unlinked_at: new Date().toISOString(),
    });

    const { unlinkTelegramAction } =
      await import('@/app/(app)/settings/notificaciones/telegram-actions');
    const res = await unlinkTelegramAction();
    expect(res.ok).toBe(true);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
