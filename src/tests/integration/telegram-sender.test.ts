/**
 * T-033 · Tests del sender real `sendTelegramReminder`.
 *
 * Cobertura:
 *  1. 200 OK → returns { ok: true, messageId }.
 *  2. 403 (bot blocked) → returns TELEGRAM_FORBIDDEN + DB blocked_count++.
 *  3. 403 con blocked_count=2 previo → llega a 3 → auto-unlink (unlinked_at,
 *     chat_id=null) + pref disabled.
 *  4. 429 → returns TELEGRAM_RATE_LIMITED + DB blocked_count intacto.
 *  5. 400 (bad request) → returns TELEGRAM_BAD_REQUEST.
 *  6. 500 (server error) → returns TELEGRAM_SERVER_ERROR.
 *  7. Network error (httpStatus=0) → returns TELEGRAM_NETWORK_ERROR.
 *
 * Mocks:
 *  - server-only: stub.
 *  - @/shared/telegram/bot-client: getTelegramBotClient retorna client
 *    con sendMessage mockeado (vi.fn).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { ReminderWithEvent } from '@/shared/notifications/types';
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Import al final para que los mocks apliquen.
import { sendTelegramReminder } from '@/shared/notifications/senders/telegram';

vi.mock('server-only', () => ({}));

const mockSendMessage = vi.fn();
vi.mock('@/shared/telegram/bot-client', () => ({
  getTelegramBotClient: () => ({
    sendMessage: mockSendMessage,
    setWebhook: vi.fn(),
    getMe: vi.fn(),
  }),
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `t033-snd-${runId}`;
const emailUser = `t033-snd-user-${runId}@example.com`;
const password = 'TestPassword123!';

let cId: string;
let userId: string;

function makeReminder(): ReminderWithEvent {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    offset_days: 7,
    event: {
      id: '22222222-2222-2222-2222-222222222222',
      titulo: 'Smoke test event',
      tipo: 'protocolo_anual',
      fecha_vencimiento: '2099-12-31',
      descripcion: null,
      status: 'pending',
      recurrence_months: null,
      created_by: null,
      consultora_id: '00000000-0000-0000-0000-000000000000',
    },
  };
}

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T033 SND', slug })
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
  await admin.from('telegram_subscriptions').delete().eq('user_id', userId);
  await admin
    .from('notification_channel_prefs')
    .delete()
    .eq('user_id', userId)
    .eq('channel', 'telegram');
});

describe('sendTelegramReminder', () => {
  it('1. 200 OK → returns { ok: true, messageId }', async () => {
    mockSendMessage.mockResolvedValueOnce({ ok: true, messageId: 42 });

    const res = await sendTelegramReminder({
      chatId: 1_000_001,
      reminder: makeReminder(),
      admin,
      userId,
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.messageId).toBe('42');
    expect(mockSendMessage).toHaveBeenCalledOnce();
    const args = mockSendMessage.mock.calls[0]!;
    expect(args[0]).toBe(1_000_001);
    expect(args[1]).toContain('*Smoke test event*');
    expect(args[2]).toMatchObject({ parseMode: 'MarkdownV2', disableWebPagePreview: true });
  });

  it('2. 403 (bot blocked) → TELEGRAM_FORBIDDEN + DB blocked_count = 1', async () => {
    await admin.from('telegram_subscriptions').insert({
      user_id: userId,
      telegram_chat_id: 2_000_002,
      linked_at: new Date().toISOString(),
      blocked_count: 0,
    });

    mockSendMessage.mockResolvedValueOnce({
      ok: false,
      httpStatus: 403,
      errorCode: 'FORBIDDEN',
      errorMessage: 'Forbidden: bot was blocked by the user',
    });

    const res = await sendTelegramReminder({
      chatId: 2_000_002,
      reminder: makeReminder(),
      admin,
      userId,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe('TELEGRAM_FORBIDDEN');
      expect(res.errorDetail).toContain('blocked');
    }

    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('blocked_count, unlinked_at, telegram_chat_id')
      .eq('user_id', userId)
      .single();
    expect(sub?.blocked_count).toBe(1);
    expect(sub?.unlinked_at).toBeNull(); // todavía no llega al threshold
    expect(sub?.telegram_chat_id).toBe(2_000_002);
  });

  it('3. 403 con blocked_count=2 previo → llega a 3 → auto-unlink + pref disabled', async () => {
    await admin.from('telegram_subscriptions').insert({
      user_id: userId,
      telegram_chat_id: 3_000_003,
      linked_at: new Date().toISOString(),
      blocked_count: 2,
    });
    // Pre-condición: pref telegram habilitada.
    await admin
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userId, channel: 'telegram', enabled: true },
        { onConflict: 'user_id,channel' },
      );

    mockSendMessage.mockResolvedValueOnce({
      ok: false,
      httpStatus: 403,
      errorCode: 'FORBIDDEN',
      errorMessage: 'Forbidden: bot was blocked',
    });

    const res = await sendTelegramReminder({
      chatId: 3_000_003,
      reminder: makeReminder(),
      admin,
      userId,
    });

    expect(res.ok).toBe(false);

    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('blocked_count, unlinked_at, telegram_chat_id')
      .eq('user_id', userId)
      .single();
    expect(sub?.blocked_count).toBe(3);
    expect(sub?.unlinked_at).toBeTruthy(); // auto-unlink disparado
    expect(sub?.telegram_chat_id).toBeNull();

    const { data: pref } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userId)
      .eq('channel', 'telegram')
      .single();
    expect(pref?.enabled).toBe(false);
  });

  it('4. 429 (rate limit) → TELEGRAM_RATE_LIMITED + blocked_count intacto', async () => {
    await admin.from('telegram_subscriptions').insert({
      user_id: userId,
      telegram_chat_id: 4_000_004,
      linked_at: new Date().toISOString(),
      blocked_count: 1,
    });

    mockSendMessage.mockResolvedValueOnce({
      ok: false,
      httpStatus: 429,
      errorCode: 'TOO_MANY_REQUESTS',
      errorMessage: 'Too Many Requests: retry after 30',
    });

    const res = await sendTelegramReminder({
      chatId: 4_000_004,
      reminder: makeReminder(),
      admin,
      userId,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe('TELEGRAM_RATE_LIMITED');
    }

    // blocked_count NO debe haber cambiado (429 no es bloqueo del user).
    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('blocked_count, unlinked_at')
      .eq('user_id', userId)
      .single();
    expect(sub?.blocked_count).toBe(1);
    expect(sub?.unlinked_at).toBeNull();
  });

  it('5. 400 (bad request) → TELEGRAM_BAD_REQUEST', async () => {
    mockSendMessage.mockResolvedValueOnce({
      ok: false,
      httpStatus: 400,
      errorCode: 'BAD_REQUEST',
      errorMessage: 'Bad Request: chat not found',
    });

    const res = await sendTelegramReminder({
      chatId: 5_000_005,
      reminder: makeReminder(),
      admin,
      userId,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe('TELEGRAM_BAD_REQUEST');
    }
  });

  it('6. 500 (server error) → TELEGRAM_SERVER_ERROR', async () => {
    mockSendMessage.mockResolvedValueOnce({
      ok: false,
      httpStatus: 500,
      errorCode: 'SERVER_ERROR',
      errorMessage: 'Internal Server Error',
    });

    const res = await sendTelegramReminder({
      chatId: 6_000_006,
      reminder: makeReminder(),
      admin,
      userId,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe('TELEGRAM_SERVER_ERROR');
    }
  });

  it('7. Network error (httpStatus=0) → TELEGRAM_NETWORK_ERROR', async () => {
    mockSendMessage.mockResolvedValueOnce({
      ok: false,
      httpStatus: 0,
      errorCode: 'NETWORK_ERROR',
      errorMessage: 'fetch failed',
    });

    const res = await sendTelegramReminder({
      chatId: 7_000_007,
      reminder: makeReminder(),
      admin,
      userId,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe('TELEGRAM_NETWORK_ERROR');
    }
  });
});
