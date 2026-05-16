/**
 * T-031 · Unit tests del orquestador `dispatchReminderToChannels`.
 *
 * Mocks: los 3 senders + el insert a notification_log via supabase mock.
 * El test verifica:
 * - Orquestacion correcta de los 3 canales.
 * - Skip por enabled=false / muted_until>now / ALREADY_SENT.
 * - Mapping de DispatchResult a notification_log row.
 * - NO_CHANNEL_IMPL_* -> status='skipped' (no failed).
 * - Email sin recipient.email -> errorCode='NO_RECIPIENT_EMAIL'.
 */
import type { ReminderWithEvent } from '@/shared/notifications/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchReminderToChannels } from '@/shared/notifications/dispatch';

vi.mock('server-only', () => ({}));

const mockSendEmail = vi.fn();
const mockSendTelegram = vi.fn();
const mockSendPush = vi.fn();

vi.mock('@/shared/notifications/senders/email', () => ({
  sendEmailReminder: (...args: unknown[]) => mockSendEmail(...args),
}));
vi.mock('@/shared/notifications/senders/telegram', () => ({
  sendTelegramReminder: (...args: unknown[]) => mockSendTelegram(...args),
}));
vi.mock('@/shared/notifications/senders/push', () => ({
  sendPushReminder: (...args: unknown[]) => mockSendPush(...args),
}));

function makeReminder(): ReminderWithEvent {
  return {
    id: 'rem-uuid-1',
    offset_days: 7,
    event: {
      id: 'evt-uuid-1',
      titulo: 'Test event',
      tipo: 'protocolo_anual',
      fecha_vencimiento: '2026-08-15',
      descripcion: null,
      status: 'pending',
      recurrence_months: 12,
      created_by: 'user-uuid-1',
      consultora_id: 'cons-uuid-1',
    },
  };
}

type LogRow = {
  consultora_id: string;
  reminder_id: string | null;
  event_id: string | null;
  recipient_user_id: string | null;
  channel: string;
  status: string;
  provider_message_id: string | null;
  error_code: string | null;
  error_detail: string | null;
};

/**
 * Mock minimo de SupabaseClient: solo `from('notification_log').select/insert`.
 * Captura las rows insertadas en `logInsertedRows` para verificar.
 *
 * Tambien soporta filtros `.eq().maybeSingle()` para la idempotency capa 3.
 */
function makeAdminMock(opts: {
  existingSentRecords?: Array<{ reminder_id: string; channel: string }>;
  // T-033 — telegram_subscriptions fixture opcional. Si no se setea,
  // el dispatcher hace lookup y devuelve null → mapea a TELEGRAM_NOT_LINKED
  // → status='skipped' (esperado para tests pre-T-033 que dejan telegram
  // como stub).
  telegramSubscriptions?: Array<{
    user_id: string;
    telegram_chat_id: number | null;
    linked_at: string | null;
    unlinked_at: string | null;
  }>;
}) {
  const logInsertedRows: LogRow[] = [];
  const existing = opts.existingSentRecords ?? [];
  const tgSubs = opts.telegramSubscriptions ?? [];

  // Builder para .from(...).select(...).eq(...).eq(...).eq(...).maybeSingle()
  function buildLogSelectChain(filters: Record<string, unknown>) {
    return {
      eq(col: string, val: unknown) {
        return buildLogSelectChain({ ...filters, [col]: val });
      },
      maybeSingle() {
        const match = existing.find(
          (r) =>
            r.reminder_id === filters.reminder_id &&
            r.channel === filters.channel &&
            filters.status === 'sent',
        );
        return Promise.resolve({ data: match ?? null, error: null });
      },
    };
  }

  // Builder para .from('telegram_subscriptions').select(...).eq('user_id', X).maybeSingle()
  function buildTgSelectChain(filters: Record<string, unknown>) {
    return {
      eq(col: string, val: unknown) {
        return buildTgSelectChain({ ...filters, [col]: val });
      },
      maybeSingle() {
        const match = tgSubs.find((s) => s.user_id === filters.user_id);
        return Promise.resolve({ data: match ?? null, error: null });
      },
    };
  }

  return {
    from(table: string) {
      if (table === 'notification_log') {
        return {
          select() {
            return buildLogSelectChain({});
          },
          insert(row: LogRow) {
            logInsertedRows.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === 'telegram_subscriptions') {
        return {
          select() {
            return buildTgSelectChain({});
          },
        };
      }
      throw new Error(`Mock no soporta tabla "${table}"`);
    },
    _logInsertedRows: logInsertedRows,
  };
}

beforeEach(() => {
  mockSendEmail.mockReset();
  mockSendTelegram.mockReset();
  mockSendPush.mockReset();

  // Defaults: telegram y push stubs.
  mockSendTelegram.mockResolvedValue({
    ok: false,
    errorCode: 'NO_CHANNEL_IMPL_T033',
    errorDetail: 'stub',
  });
  mockSendPush.mockResolvedValue({
    ok: false,
    errorCode: 'NO_CHANNEL_IMPL_T034',
    errorDetail: 'stub',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('dispatchReminderToChannels · happy path', () => {
  it('1. Email + telegram + push enabled -> 3 outcomes con email sent + stubs skipped', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: true, messageId: 'rsd_test_1' });

    const admin = makeAdminMock({});
    const outcomes = await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: 'user@example.com', name: 'Juan', userId: 'user-uuid-1' },
      prefs: [
        { channel: 'email', enabled: true, muted_until: null },
        { channel: 'telegram', enabled: true, muted_until: null },
        { channel: 'push', enabled: true, muted_until: null },
      ],
    });

    expect(outcomes).toHaveLength(3);
    expect(outcomes[0]).toEqual({
      channel: 'email',
      status: 'sent',
      message_id: 'rsd_test_1',
    });
    // Post-T-033: sin sub linkeada → dispatcher devuelve TELEGRAM_NOT_LINKED
    // ANTES de invocar al sender. Push sigue como stub T-034.
    expect(outcomes[1]).toEqual({
      channel: 'telegram',
      status: 'skipped',
      error_code: 'TELEGRAM_NOT_LINKED',
    });
    expect(outcomes[2]).toEqual({
      channel: 'push',
      status: 'skipped',
      error_code: 'NO_CHANNEL_IMPL_T034',
    });

    // 3 rows escritas a notification_log.
    expect(admin._logInsertedRows).toHaveLength(3);
    const emailRow = admin._logInsertedRows.find((r) => r.channel === 'email');
    expect(emailRow?.status).toBe('sent');
    expect(emailRow?.provider_message_id).toBe('rsd_test_1');
    expect(emailRow?.consultora_id).toBe('cons-uuid-1');
    expect(emailRow?.reminder_id).toBe('rem-uuid-1');
    expect(emailRow?.event_id).toBe('evt-uuid-1');
    expect(emailRow?.recipient_user_id).toBe('user-uuid-1');
  });

  it('2. Email sender pasa recipientName al sender', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: true, messageId: 'rsd_test_2' });

    const admin = makeAdminMock({});
    await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: 'user@example.com', name: 'Maria López', userId: 'u1' },
      prefs: [{ channel: 'email', enabled: true, muted_until: null }],
    });

    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'user@example.com',
      recipientName: 'Maria López',
      reminder: expect.objectContaining({ id: 'rem-uuid-1' }),
    });
  });
});

describe('dispatchReminderToChannels · email failed', () => {
  it('3. Resend devuelve error -> notification_log row con status=failed + error_code', async () => {
    mockSendEmail.mockResolvedValueOnce({
      ok: false,
      errorCode: 'RESEND_VALIDATION_ERROR',
      errorDetail: 'Invalid recipient',
    });

    const admin = makeAdminMock({});
    const outcomes = await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: 'user@example.com', name: null, userId: 'u1' },
      prefs: [{ channel: 'email', enabled: true, muted_until: null }],
    });

    expect(outcomes[0]).toEqual({
      channel: 'email',
      status: 'failed',
      error_code: 'RESEND_VALIDATION_ERROR',
    });

    const emailRow = admin._logInsertedRows.find((r) => r.channel === 'email');
    expect(emailRow?.status).toBe('failed');
    expect(emailRow?.error_code).toBe('RESEND_VALIDATION_ERROR');
    expect(emailRow?.error_detail).toBe('Invalid recipient');
    expect(emailRow?.provider_message_id).toBeNull();
  });
});

describe('dispatchReminderToChannels · prefs', () => {
  it('4. enabled=false -> skipped DISABLED (sin llamar sender ni log)', async () => {
    const admin = makeAdminMock({});
    const outcomes = await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: 'user@example.com', name: null, userId: 'u1' },
      prefs: [{ channel: 'email', enabled: false, muted_until: null }],
    });

    expect(outcomes[0]).toEqual({
      channel: 'email',
      status: 'skipped',
      error_code: 'DISABLED',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
    // No row escrita para email (ruido).
    expect(admin._logInsertedRows.find((r) => r.channel === 'email')).toBeUndefined();
  });

  it('5. muted_until futuro -> skipped MUTED', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const admin = makeAdminMock({});
    const outcomes = await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: 'user@example.com', name: null, userId: 'u1' },
      prefs: [{ channel: 'email', enabled: true, muted_until: future }],
    });

    expect(outcomes[0]).toEqual({
      channel: 'email',
      status: 'skipped',
      error_code: 'MUTED',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('6. muted_until pasado -> NO skipea (mute expirado)', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: true, messageId: 'rsd_test_3' });
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const admin = makeAdminMock({});

    const outcomes = await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: 'user@example.com', name: null, userId: 'u1' },
      prefs: [{ channel: 'email', enabled: true, muted_until: past }],
    });

    expect(outcomes[0]).toEqual({
      channel: 'email',
      status: 'sent',
      message_id: 'rsd_test_3',
    });
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('7. prefs sin entry para email -> default enabled (defensa backfill)', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: true, messageId: 'rsd_test_4' });
    const admin = makeAdminMock({});

    const outcomes = await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: 'user@example.com', name: null, userId: 'u1' },
      prefs: [], // sin entry email
    });

    expect(outcomes[0]?.status).toBe('sent');
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('8. prefs sin entry para telegram/push -> default disabled (no stub call)', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: true, messageId: 'rsd_test_5' });
    const admin = makeAdminMock({});

    const outcomes = await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: 'user@example.com', name: null, userId: 'u1' },
      prefs: [{ channel: 'email', enabled: true, muted_until: null }],
    });

    // Telegram + push default disabled si NO hay entry en prefs.
    expect(outcomes[1]).toEqual({
      channel: 'telegram',
      status: 'skipped',
      error_code: 'DISABLED',
    });
    expect(outcomes[2]).toEqual({
      channel: 'push',
      status: 'skipped',
      error_code: 'DISABLED',
    });
    expect(mockSendTelegram).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

describe('dispatchReminderToChannels · idempotency capa 3', () => {
  it('9. ALREADY_SENT detectado por notification_log existing record', async () => {
    const admin = makeAdminMock({
      existingSentRecords: [{ reminder_id: 'rem-uuid-1', channel: 'email' }],
    });

    const outcomes = await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: 'user@example.com', name: null, userId: 'u1' },
      prefs: [{ channel: 'email', enabled: true, muted_until: null }],
    });

    expect(outcomes[0]).toEqual({
      channel: 'email',
      status: 'skipped',
      error_code: 'ALREADY_SENT',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
    // No row nueva (ya habia una previa).
    expect(admin._logInsertedRows.find((r) => r.channel === 'email')).toBeUndefined();
  });
});

describe('dispatchReminderToChannels · email sin recipient.email', () => {
  it('10. recipient.email=null + email enabled -> error_code=NO_RECIPIENT_EMAIL', async () => {
    const admin = makeAdminMock({});

    const outcomes = await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: null, name: null, userId: 'u1' },
      prefs: [{ channel: 'email', enabled: true, muted_until: null }],
    });

    expect(outcomes[0]).toEqual({
      channel: 'email',
      status: 'failed',
      error_code: 'NO_RECIPIENT_EMAIL',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();

    const emailRow = admin._logInsertedRows.find((r) => r.channel === 'email');
    expect(emailRow?.status).toBe('failed');
    expect(emailRow?.error_code).toBe('NO_RECIPIENT_EMAIL');
  });
});

describe('dispatchReminderToChannels · stubs T-033/T-034', () => {
  it('11. Telegram sin sub linkeada -> skipped TELEGRAM_NOT_LINKED + log row (post-T-033)', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: true, messageId: 'rsd_test_6' });
    const admin = makeAdminMock({});

    const outcomes = await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: 'user@example.com', name: null, userId: 'u1' },
      prefs: [
        { channel: 'email', enabled: true, muted_until: null },
        { channel: 'telegram', enabled: true, muted_until: null },
      ],
    });

    expect(outcomes[1]).toEqual({
      channel: 'telegram',
      status: 'skipped',
      error_code: 'TELEGRAM_NOT_LINKED',
    });

    const telegramRow = admin._logInsertedRows.find((r) => r.channel === 'telegram');
    expect(telegramRow?.status).toBe('skipped'); // NO 'failed'
    expect(telegramRow?.error_code).toBe('TELEGRAM_NOT_LINKED');
  });

  it('12. Telegram con sub linkeada → invoca sender real (post-T-033)', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: true, messageId: 'rsd_test_7' });
    mockSendTelegram.mockResolvedValueOnce({ ok: true, messageId: '42' });
    const admin = makeAdminMock({
      telegramSubscriptions: [
        {
          user_id: 'u1',
          telegram_chat_id: 12345,
          linked_at: '2026-01-01T00:00:00Z',
          unlinked_at: null,
        },
      ],
    });

    const outcomes = await dispatchReminderToChannels({
      admin: admin as never,
      reminder: makeReminder(),
      recipient: { email: 'user@example.com', name: null, userId: 'u1' },
      prefs: [
        { channel: 'email', enabled: true, muted_until: null },
        { channel: 'telegram', enabled: true, muted_until: null },
      ],
    });

    expect(outcomes[1]).toEqual({
      channel: 'telegram',
      status: 'sent',
      message_id: '42',
    });
    expect(mockSendTelegram).toHaveBeenCalledOnce();
    expect(mockSendTelegram.mock.calls[0]![0]).toMatchObject({
      chatId: 12345,
      userId: 'u1',
    });
  });
});
