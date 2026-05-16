/**
 * T-037 · Tests del endpoint POST /api/calendar/dispatch-reminder cubriendo
 * el flow multi-canal (Email + Telegram en paralelo).
 *
 * Complementa a:
 *  - `dispatch-reminder-endpoint.test.ts` (T-031): auth, input validation,
 *    happy path single canal email, defensas event NOT_PENDING / created_by
 *    null, idempotency single canal email, Resend error single canal.
 *  - `telegram-sender.test.ts` (T-033): sender Telegram aislado (200, 403
 *    blocked_count, 403 auto-unlink, 429, 400, 500, network).
 *
 * Lo nuevo de T-037: interaccion entre los DOS canales (email + telegram)
 * + edge cases del orquestador `dispatchReminderToChannels` que solo emergen
 * cuando ambos canales estan en juego.
 *
 * Cobertura (10 tests):
 *  1. Email enabled + Telegram disabled -> 1 row sent (email), Telegram sender NO llamado.
 *  2. Email disabled + Telegram enabled (linked) -> 1 row sent (telegram), Resend NO llamado.
 *  3. Ambos disabled -> 0 rows en notification_log (skip silent del dispatcher).
 *  4. Ambos enabled + muted_until futuro -> 0 rows (mute global activo).
 *  5. Ambos enabled + muted_until pasado (expirado) -> 2 rows sent.
 *  6. Idempotency capa 3 con AMBOS canales: 2 POSTs -> 2do no inserta nuevos
 *     rows, outcomes traen ALREADY_SENT en ambos canales.
 *  7. TELEGRAM_NOT_LINKED: email enabled + telegram enabled pero user sin sub
 *     linkeada -> 1 row sent (email) + 1 row skipped TELEGRAM_NOT_LINKED.
 *  8. Telegram 429 + Email OK -> 1 row sent (email) + 1 row failed
 *     TELEGRAM_RATE_LIMITED, blocked_count intacto.
 *  9. Telegram 403 incrementa blocked_count + Email OK -> 1 row sent (email)
 *     + 1 row failed TELEGRAM_FORBIDDEN, sub.blocked_count++.
 * 10. Telegram 403 con blocked_count=2 previo -> 3er fail dispara auto-unlink
 *     (sub.unlinked_at set + chat_id=null + pref telegram disabled) + Email OK.
 *
 * Mocks:
 *  - `server-only`: stub.
 *  - `@/shared/notifications/resend`: factory con `emails.send` mockeado.
 *  - `@/shared/telegram/bot-client`: factory con `sendMessage` mockeado.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Import del handler AL FINAL para que los mocks aplicen.
import { POST } from '@/app/api/calendar/dispatch-reminder/route';
import { env } from '@/env';

vi.mock('server-only', () => ({}));

const mockEmailsSend = vi.fn();
vi.mock('@/shared/notifications/resend', () => ({
  getResendClient: () => ({
    emails: { send: mockEmailsSend },
  }),
}));

const mockTelegramSendMessage = vi.fn();
vi.mock('@/shared/telegram/bot-client', () => ({
  getTelegramBotClient: () => ({
    sendMessage: mockTelegramSendMessage,
    setWebhook: vi.fn(),
    getMe: vi.fn(),
  }),
  _resetTelegramBotClientForTests: vi.fn(),
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
const slug = `t037-mc-${runId}`;
const emailUser = `t037-mc-${runId}@example.com`;
const password = 'TestPassword123!';

let cId: string;
let userId: string;
let eventId: string;
let nextChatId = 50_000_000; // base para chat_ids unicos por test

function isoDaysAhead(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function makeRequest(reminderId: string): NextRequest {
  return new NextRequest('http://localhost/api/calendar/dispatch-reminder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Cron-Secret': env.INTERNAL_CRON_SECRET,
    },
    body: JSON.stringify({ reminder_id: reminderId }),
  });
}

/**
 * Crea un reminder fresh para el event compartido. Cada test usa su propio
 * reminder para que las assertions de notification_log no se contaminen
 * con rows de tests previos.
 */
async function createReminder(offsetDays: number): Promise<string> {
  const { data: r } = await admin
    .from('calendar_event_reminders')
    .insert({
      event_id: eventId,
      consultora_id: cId,
      offset_days: offsetDays,
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .select('id')
    .single();
  return r!.id;
}

/**
 * Setea prefs del user para email + telegram explicitamente. Borra previas
 * primero para evitar leak entre tests.
 */
async function setPrefs(opts: {
  emailEnabled: boolean;
  telegramEnabled: boolean;
  mutedUntil?: string | null;
}): Promise<void> {
  // Borrar todas las prefs del user para empezar limpio.
  await admin.from('notification_channel_prefs').delete().eq('user_id', userId);

  await admin.from('notification_channel_prefs').insert([
    {
      user_id: userId,
      channel: 'email',
      enabled: opts.emailEnabled,
      muted_until: opts.mutedUntil ?? null,
    },
    {
      user_id: userId,
      channel: 'telegram',
      enabled: opts.telegramEnabled,
      muted_until: opts.mutedUntil ?? null,
    },
  ]);
}

/**
 * Linkea telegram para el user con chat_id fresh + blocked_count = 0.
 * Borra sub previa para evitar UNIQUE conflict.
 */
async function linkTelegram(blockedCount = 0): Promise<number> {
  await admin.from('telegram_subscriptions').delete().eq('user_id', userId);
  const chatId = ++nextChatId;
  await admin.from('telegram_subscriptions').insert({
    user_id: userId,
    telegram_chat_id: chatId,
    linked_at: new Date().toISOString(),
    blocked_count: blockedCount,
  });
  return chatId;
}

async function unlinkTelegram(): Promise<void> {
  await admin.from('telegram_subscriptions').delete().eq('user_id', userId);
}

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T037 MC', slug })
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

  await admin.auth.admin.updateUserById(userId, {
    app_metadata: { consultora_id: cId },
  });

  // Event pending compartido entre tests. Reminder se crea fresh per test.
  const { data: ev } = await admin
    .from('calendar_events')
    .insert({
      consultora_id: cId,
      tipo: 'custom',
      titulo: 'T037 multi-canal',
      fecha_vencimiento: isoDaysAhead(7),
      reminder_offsets_days: [7, 0],
      status: 'pending',
      created_by: userId,
    })
    .select('id')
    .single();
  eventId = ev!.id;
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userId).catch(() => {});
});

beforeEach(async () => {
  mockEmailsSend.mockReset();
  mockTelegramSendMessage.mockReset();
  // Cleanup defensivo de telegram_subscriptions entre tests.
  await admin.from('telegram_subscriptions').delete().eq('user_id', userId);
});

describe('POST /api/calendar/dispatch-reminder · multi-canal', () => {
  it('1. Email enabled + Telegram disabled -> solo row email sent', async () => {
    await setPrefs({ emailEnabled: true, telegramEnabled: false });
    const reminderId = await createReminder(7);

    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'rsd_t1' }, error: null });

    const res = await POST(makeRequest(reminderId));
    expect(res.status).toBe(200);

    expect(mockEmailsSend).toHaveBeenCalledOnce();
    expect(mockTelegramSendMessage).not.toHaveBeenCalled();

    const { data: logs } = await admin
      .from('notification_log')
      .select('channel, status, provider_message_id, error_code')
      .eq('reminder_id', reminderId);
    // Email log + Telegram log (skipped DISABLED) + Push log (skipped DISABLED por default).
    // DISABLED no se loguea segun dispatch.ts:79 (skip silent sin log).
    // Asi que solo deberia haber 1 row: email sent.
    expect(logs).toHaveLength(1);
    expect(logs![0]!.channel).toBe('email');
    expect(logs![0]!.status).toBe('sent');
    expect(logs![0]!.provider_message_id).toBe('rsd_t1');
  });

  it('2. Email disabled + Telegram enabled (linked) -> solo row telegram sent', async () => {
    await setPrefs({ emailEnabled: false, telegramEnabled: true });
    const chatId = await linkTelegram();
    const reminderId = await createReminder(14);

    mockTelegramSendMessage.mockResolvedValueOnce({ ok: true, messageId: 101 });

    const res = await POST(makeRequest(reminderId));
    expect(res.status).toBe(200);

    expect(mockTelegramSendMessage).toHaveBeenCalledOnce();
    expect(mockTelegramSendMessage.mock.calls[0]![0]).toBe(chatId);
    expect(mockEmailsSend).not.toHaveBeenCalled();

    const { data: logs } = await admin
      .from('notification_log')
      .select('channel, status, provider_message_id')
      .eq('reminder_id', reminderId);
    expect(logs).toHaveLength(1);
    expect(logs![0]!.channel).toBe('telegram');
    expect(logs![0]!.status).toBe('sent');
    expect(logs![0]!.provider_message_id).toBe('101');
  });

  it('3. Ambos disabled -> 0 rows en notification_log', async () => {
    await setPrefs({ emailEnabled: false, telegramEnabled: false });
    const reminderId = await createReminder(21);

    const res = await POST(makeRequest(reminderId));
    expect(res.status).toBe(200);

    expect(mockEmailsSend).not.toHaveBeenCalled();
    expect(mockTelegramSendMessage).not.toHaveBeenCalled();

    const { data: logs } = await admin
      .from('notification_log')
      .select('id')
      .eq('reminder_id', reminderId);
    expect(logs).toEqual([]);

    // Sanity check del body: outcomes tienen status='skipped' error_code='DISABLED'.
    const body = await res.json();
    const channels = body.channels as Array<{
      channel: string;
      status: string;
      error_code?: string;
    }>;
    const email = channels.find((c) => c.channel === 'email');
    const telegram = channels.find((c) => c.channel === 'telegram');
    expect(email?.status).toBe('skipped');
    expect(email?.error_code).toBe('DISABLED');
    expect(telegram?.status).toBe('skipped');
    expect(telegram?.error_code).toBe('DISABLED');
  });

  it('4. Ambos enabled + muted_until futuro -> 0 rows (mute activo)', async () => {
    const futureIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await setPrefs({ emailEnabled: true, telegramEnabled: true, mutedUntil: futureIso });
    await linkTelegram();
    const reminderId = await createReminder(28);

    const res = await POST(makeRequest(reminderId));
    expect(res.status).toBe(200);

    expect(mockEmailsSend).not.toHaveBeenCalled();
    expect(mockTelegramSendMessage).not.toHaveBeenCalled();

    const { data: logs } = await admin
      .from('notification_log')
      .select('id')
      .eq('reminder_id', reminderId);
    expect(logs).toEqual([]);

    const body = await res.json();
    const channels = body.channels as Array<{
      channel: string;
      status: string;
      error_code?: string;
    }>;
    expect(channels.find((c) => c.channel === 'email')?.error_code).toBe('MUTED');
    expect(channels.find((c) => c.channel === 'telegram')?.error_code).toBe('MUTED');
  });

  it('5. Ambos enabled + muted_until pasado (expirado) -> 2 rows sent', async () => {
    const pastIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await setPrefs({ emailEnabled: true, telegramEnabled: true, mutedUntil: pastIso });
    await linkTelegram();
    const reminderId = await createReminder(35);

    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'rsd_t5' }, error: null });
    mockTelegramSendMessage.mockResolvedValueOnce({ ok: true, messageId: 505 });

    const res = await POST(makeRequest(reminderId));
    expect(res.status).toBe(200);

    expect(mockEmailsSend).toHaveBeenCalledOnce();
    expect(mockTelegramSendMessage).toHaveBeenCalledOnce();

    const { data: logs } = await admin
      .from('notification_log')
      .select('channel, status')
      .eq('reminder_id', reminderId);
    expect(logs).toHaveLength(2);
    const channels = logs!.map((l) => l.channel).sort();
    expect(channels).toEqual(['email', 'telegram']);
    expect(logs!.every((l) => l.status === 'sent')).toBe(true);
  });

  it('6. Idempotency multi-canal: 2 POSTs -> 2do retorna ALREADY_SENT ambos, sin nuevos rows', async () => {
    await setPrefs({ emailEnabled: true, telegramEnabled: true });
    await linkTelegram();
    const reminderId = await createReminder(42);

    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'rsd_t6' }, error: null });
    mockTelegramSendMessage.mockResolvedValueOnce({ ok: true, messageId: 606 });

    // 1er POST: ambos sent.
    const res1 = await POST(makeRequest(reminderId));
    expect(res1.status).toBe(200);
    expect(mockEmailsSend).toHaveBeenCalledTimes(1);
    expect(mockTelegramSendMessage).toHaveBeenCalledTimes(1);

    const { data: logsAfter1 } = await admin
      .from('notification_log')
      .select('id')
      .eq('reminder_id', reminderId);
    expect(logsAfter1).toHaveLength(2);

    // 2do POST: el dispatcher detecta ALREADY_SENT y retorna sin invocar senders ni
    // insertar log nuevo (ver dispatch.ts:94-96).
    const res2 = await POST(makeRequest(reminderId));
    expect(res2.status).toBe(200);

    // Mocks NO incrementan: dispatcher cortocircuita en idempotency check.
    expect(mockEmailsSend).toHaveBeenCalledTimes(1);
    expect(mockTelegramSendMessage).toHaveBeenCalledTimes(1);

    const { data: logsAfter2 } = await admin
      .from('notification_log')
      .select('id')
      .eq('reminder_id', reminderId);
    // Sigue habiendo 2 rows (no se duplico).
    expect(logsAfter2).toHaveLength(2);

    // Outcomes de la 2da request marcan skipped ALREADY_SENT.
    const body2 = await res2.json();
    const channels = body2.channels as Array<{
      channel: string;
      status: string;
      error_code?: string;
    }>;
    expect(channels.find((c) => c.channel === 'email')?.status).toBe('skipped');
    expect(channels.find((c) => c.channel === 'email')?.error_code).toBe('ALREADY_SENT');
    expect(channels.find((c) => c.channel === 'telegram')?.status).toBe('skipped');
    expect(channels.find((c) => c.channel === 'telegram')?.error_code).toBe('ALREADY_SENT');
  });

  it('7. TELEGRAM_NOT_LINKED: email sent + telegram skipped', async () => {
    await setPrefs({ emailEnabled: true, telegramEnabled: true });
    await unlinkTelegram(); // sin sub
    const reminderId = await createReminder(49);

    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'rsd_t7' }, error: null });

    const res = await POST(makeRequest(reminderId));
    expect(res.status).toBe(200);

    expect(mockEmailsSend).toHaveBeenCalledOnce();
    expect(mockTelegramSendMessage).not.toHaveBeenCalled();

    const { data: logs } = await admin
      .from('notification_log')
      .select('channel, status, error_code')
      .eq('reminder_id', reminderId);
    expect(logs).toHaveLength(2);
    const email = logs!.find((l) => l.channel === 'email');
    const telegram = logs!.find((l) => l.channel === 'telegram');
    expect(email?.status).toBe('sent');
    expect(telegram?.status).toBe('skipped');
    expect(telegram?.error_code).toBe('TELEGRAM_NOT_LINKED');
  });

  it('8. Telegram 429 + Email OK -> 1 sent (email) + 1 failed (telegram), blocked_count intacto', async () => {
    await setPrefs({ emailEnabled: true, telegramEnabled: true });
    await linkTelegram(1); // blocked_count previo = 1
    const reminderId = await createReminder(56);

    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'rsd_t8' }, error: null });
    mockTelegramSendMessage.mockResolvedValueOnce({
      ok: false,
      httpStatus: 429,
      errorCode: 'TOO_MANY_REQUESTS',
      errorMessage: 'Too Many Requests: retry after 30',
    });

    const res = await POST(makeRequest(reminderId));
    expect(res.status).toBe(200);

    const { data: logs } = await admin
      .from('notification_log')
      .select('channel, status, error_code')
      .eq('reminder_id', reminderId);
    expect(logs).toHaveLength(2);
    expect(logs!.find((l) => l.channel === 'email')?.status).toBe('sent');
    expect(logs!.find((l) => l.channel === 'telegram')?.status).toBe('failed');
    expect(logs!.find((l) => l.channel === 'telegram')?.error_code).toBe('TELEGRAM_RATE_LIMITED');

    // blocked_count NO debe haberse incrementado (429 != bloqueo del user).
    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('blocked_count, unlinked_at')
      .eq('user_id', userId)
      .single();
    expect(sub?.blocked_count).toBe(1);
    expect(sub?.unlinked_at).toBeNull();
  });

  it('9. Telegram 403 (bot blocked) + Email OK -> sub.blocked_count++ + Email row sent', async () => {
    await setPrefs({ emailEnabled: true, telegramEnabled: true });
    await linkTelegram(0);
    const reminderId = await createReminder(63);

    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'rsd_t9' }, error: null });
    mockTelegramSendMessage.mockResolvedValueOnce({
      ok: false,
      httpStatus: 403,
      errorCode: 'FORBIDDEN',
      errorMessage: 'Forbidden: bot was blocked by the user',
    });

    const res = await POST(makeRequest(reminderId));
    expect(res.status).toBe(200);

    const { data: logs } = await admin
      .from('notification_log')
      .select('channel, status, error_code')
      .eq('reminder_id', reminderId);
    expect(logs).toHaveLength(2);
    expect(logs!.find((l) => l.channel === 'email')?.status).toBe('sent');
    expect(logs!.find((l) => l.channel === 'telegram')?.status).toBe('failed');
    expect(logs!.find((l) => l.channel === 'telegram')?.error_code).toBe('TELEGRAM_FORBIDDEN');

    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('blocked_count, unlinked_at, telegram_chat_id')
      .eq('user_id', userId)
      .single();
    expect(sub?.blocked_count).toBe(1);
    expect(sub?.unlinked_at).toBeNull();
    expect(sub?.telegram_chat_id).not.toBeNull();
  });

  it('10. Telegram 403 con blocked_count=2 previo -> auto-unlink + pref disabled + Email sigue OK', async () => {
    await setPrefs({ emailEnabled: true, telegramEnabled: true });
    await linkTelegram(2); // 2 strikes previos
    const reminderId = await createReminder(70);

    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'rsd_t10' }, error: null });
    mockTelegramSendMessage.mockResolvedValueOnce({
      ok: false,
      httpStatus: 403,
      errorCode: 'FORBIDDEN',
      errorMessage: 'Forbidden: bot was blocked',
    });

    const res = await POST(makeRequest(reminderId));
    expect(res.status).toBe(200);

    const { data: logs } = await admin
      .from('notification_log')
      .select('channel, status, error_code')
      .eq('reminder_id', reminderId);
    expect(logs).toHaveLength(2);
    expect(logs!.find((l) => l.channel === 'email')?.status).toBe('sent');
    expect(logs!.find((l) => l.channel === 'telegram')?.status).toBe('failed');

    // Auto-unlink disparado: blocked_count=3 + unlinked_at!=null + chat_id=null.
    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('blocked_count, unlinked_at, telegram_chat_id')
      .eq('user_id', userId)
      .single();
    expect(sub?.blocked_count).toBe(3);
    expect(sub?.unlinked_at).toBeTruthy();
    expect(sub?.telegram_chat_id).toBeNull();

    // Pref telegram automaticamente disabled por el sender (telegram.ts:75-80).
    const { data: pref } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userId)
      .eq('channel', 'telegram')
      .single();
    expect(pref?.enabled).toBe(false);
  });
});
