/**
 * T-034 · Tests del sender real Web Push.
 *
 * Cobertura:
 *  1. Sin subs en DB → PUSH_NO_SUBSCRIPTIONS (skippable code).
 *  2. 1 sub, statusCode 200 → ok + last_seen_at updateado.
 *  3. 1 sub, statusCode 201 → ok (algunos providers retornan 201).
 *  4. 1 sub, 410 Gone → DELETE row + PUSH_ALL_EXPIRED + auto-disable pref.
 *  5. 1 sub, 404 Not Found → DELETE row + PUSH_ALL_EXPIRED + auto-disable pref.
 *  6. Multi-sub: 1 OK + 1 410 → ok partial + cleanup parcial + pref preserva.
 *  7. Multi-sub: todas 410 → PUSH_ALL_EXPIRED + auto-disable.
 *  8. 1 sub, 413 Payload Too Large → log warn + PUSH_ALL_FAILED, sin cleanup.
 *  9. 1 sub, 500 server error → PUSH_ALL_FAILED, sin cleanup.
 * 10. Payload > 4KB → body truncado defensivo (smoke check).
 *
 * Mock: vi.mock('@/shared/push/web-push-client').
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { ReminderWithEvent } from '@/shared/notifications/types';
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendPushReminder } from '@/shared/notifications/senders/push';

vi.mock('server-only', () => ({}));

const mockSendNotification = vi.fn();
vi.mock('@/shared/push/web-push-client', () => ({
  getWebPushClient: () => ({
    sendNotification: mockSendNotification,
  }),
  _resetWebPushClientForTests: vi.fn(),
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error('Tests requieren env vars Supabase.');
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `t034-snd-${runId}`;
const emailUser = `t034-snd-user-${runId}@example.com`;
const password = 'TestPassword123!';

let cId: string;
let userId: string;
let reminder: ReminderWithEvent;

function endpoint(suffix: string): string {
  return `https://fcm.googleapis.com/fcm/send/t034-snd-${runId}-${suffix}`;
}

async function insertSub(ep: string): Promise<string> {
  const { data } = await admin
    .from('push_subscriptions')
    .insert({
      user_id: userId,
      endpoint: ep,
      p256dh_key: 'fake-p256dh',
      auth_key: 'fake-auth',
    })
    .select('id')
    .single();
  return data!.id;
}

function makeWebPushError(
  statusCode: number,
  msg = 'web-push error',
): Error & { statusCode: number } {
  const err = new Error(msg) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T034 snd', slug })
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

  // Crear un event + reminder real para shape correcto.
  const { data: ev } = await admin
    .from('calendar_events')
    .insert({
      consultora_id: cId,
      tipo: 'protocolo_anual',
      titulo: 'Protocolo smoke T-034',
      fecha_vencimiento: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      created_by: userId,
      reminder_offsets_days: [7],
    })
    .select('*')
    .single();

  const { data: rem } = await admin
    .from('calendar_event_reminders')
    .insert({
      event_id: ev!.id,
      consultora_id: cId,
      offset_days: 7,
      scheduled_at: new Date().toISOString(),
    })
    .select('id, offset_days')
    .single();

  reminder = {
    id: rem!.id,
    offset_days: rem!.offset_days,
    event: {
      id: ev!.id,
      titulo: ev!.titulo,
      tipo: ev!.tipo,
      fecha_vencimiento: ev!.fecha_vencimiento,
      descripcion: ev!.descripcion,
      status: ev!.status as 'pending',
      recurrence_months: ev!.recurrence_months,
      created_by: ev!.created_by,
      consultora_id: ev!.consultora_id,
    },
  };
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userId).catch(() => {});
});

beforeEach(async () => {
  mockSendNotification.mockReset();
  await admin.from('push_subscriptions').delete().eq('user_id', userId);
  await admin
    .from('notification_channel_prefs')
    .delete()
    .eq('user_id', userId)
    .eq('channel', 'push');
});

// Poll helper: cleanup/update son fire-and-forget (void). Esperamos efecto async.
async function waitFor(check: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

describe('sendPushReminder', () => {
  it('1. sin subs → PUSH_NO_SUBSCRIPTIONS', async () => {
    const res = await sendPushReminder({ reminder, admin, userId });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe('PUSH_NO_SUBSCRIPTIONS');
    }
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('2. 1 sub, statusCode 200 → ok + last_seen_at updated', async () => {
    const subId = await insertSub(endpoint('S2'));
    const { data: before } = await admin
      .from('push_subscriptions')
      .select('last_seen_at')
      .eq('id', subId)
      .single();
    const beforeMs = new Date(before!.last_seen_at!).getTime();

    mockSendNotification.mockResolvedValue({ statusCode: 200, body: '', headers: {} });

    const res = await sendPushReminder({ reminder, admin, userId });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.messageId).toBe('push:1/1');
    }
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    // sendNotification recibe (subscription, payload, options)
    expect(mockSendNotification.mock.calls[0]![0]).toMatchObject({
      endpoint: endpoint('S2'),
      keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' },
    });
    expect(mockSendNotification.mock.calls[0]![2]).toMatchObject({ TTL: 86400 });

    // last_seen_at fue updated (poll async).
    await waitFor(async () => {
      const { data: after } = await admin
        .from('push_subscriptions')
        .select('last_seen_at')
        .eq('id', subId)
        .single();
      return new Date(after!.last_seen_at!).getTime() > beforeMs;
    });
  });

  it('3. 1 sub, statusCode 201 → ok (algunos providers retornan 201)', async () => {
    await insertSub(endpoint('S3'));
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });

    const res = await sendPushReminder({ reminder, admin, userId });
    expect(res.ok).toBe(true);
  });

  it('4. 1 sub, 410 Gone → DELETE row + PUSH_ALL_EXPIRED + auto-disable pref', async () => {
    const subId = await insertSub(endpoint('S4'));
    // Setup pref enabled.
    await admin
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userId, channel: 'push', enabled: true },
        { onConflict: 'user_id,channel' },
      );

    mockSendNotification.mockRejectedValue(makeWebPushError(410, 'Gone'));

    const res = await sendPushReminder({ reminder, admin, userId });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe('PUSH_ALL_EXPIRED');
    }

    // Cleanup async: poll hasta que row no exista.
    await waitFor(async () => {
      const { data } = await admin
        .from('push_subscriptions')
        .select('id')
        .eq('id', subId)
        .maybeSingle();
      return data === null;
    });

    // Pref auto-disabled (también async).
    await waitFor(async () => {
      const { data: pref } = await admin
        .from('notification_channel_prefs')
        .select('enabled')
        .eq('user_id', userId)
        .eq('channel', 'push')
        .single();
      return pref?.enabled === false;
    });
  });

  it('5. 1 sub, 404 Not Found → DELETE row + PUSH_ALL_EXPIRED', async () => {
    const subId = await insertSub(endpoint('S5'));
    mockSendNotification.mockRejectedValue(makeWebPushError(404, 'Not Found'));

    const res = await sendPushReminder({ reminder, admin, userId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('PUSH_ALL_EXPIRED');

    await waitFor(async () => {
      const { data } = await admin
        .from('push_subscriptions')
        .select('id')
        .eq('id', subId)
        .maybeSingle();
      return data === null;
    });
  });

  it('6. multi-sub: 1 OK + 1 410 → ok partial + cleanup parcial + pref preserva', async () => {
    const sub1Id = await insertSub(endpoint('S6-ok'));
    const sub2Id = await insertSub(endpoint('S6-gone'));
    await admin
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userId, channel: 'push', enabled: true },
        { onConflict: 'user_id,channel' },
      );

    mockSendNotification
      .mockResolvedValueOnce({ statusCode: 200, body: '', headers: {} })
      .mockRejectedValueOnce(makeWebPushError(410, 'Gone'));

    const res = await sendPushReminder({ reminder, admin, userId });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.messageId).toBe('push:1/2');
    }

    // Cleanup parcial: sub2 borrada, sub1 sigue.
    await waitFor(async () => {
      const { data: r2 } = await admin
        .from('push_subscriptions')
        .select('id')
        .eq('id', sub2Id)
        .maybeSingle();
      return r2 === null;
    });
    const { data: r1 } = await admin
      .from('push_subscriptions')
      .select('id')
      .eq('id', sub1Id)
      .maybeSingle();
    expect(r1?.id).toBe(sub1Id);

    // Pref preserva enabled (quedan otras subs OK).
    const { data: pref } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userId)
      .eq('channel', 'push')
      .single();
    expect(pref?.enabled).toBe(true);
  });

  it('7. multi-sub: TODAS 410 → PUSH_ALL_EXPIRED + auto-disable', async () => {
    await insertSub(endpoint('S7-a'));
    await insertSub(endpoint('S7-b'));
    await admin
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userId, channel: 'push', enabled: true },
        { onConflict: 'user_id,channel' },
      );

    mockSendNotification.mockRejectedValue(makeWebPushError(410, 'Gone'));

    const res = await sendPushReminder({ reminder, admin, userId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('PUSH_ALL_EXPIRED');

    await waitFor(async () => {
      const { count } = await admin
        .from('push_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      return count === 0;
    });

    await waitFor(async () => {
      const { data: pref } = await admin
        .from('notification_channel_prefs')
        .select('enabled')
        .eq('user_id', userId)
        .eq('channel', 'push')
        .single();
      return pref?.enabled === false;
    });
  });

  it('8. 1 sub, 413 Payload Too Large → PUSH_ALL_FAILED sin cleanup', async () => {
    const subId = await insertSub(endpoint('S8'));
    mockSendNotification.mockRejectedValue(makeWebPushError(413, 'Payload Too Large'));

    const res = await sendPushReminder({ reminder, admin, userId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('PUSH_ALL_FAILED');

    // Row NO se borró (413 no es cleanup).
    const { data } = await admin
      .from('push_subscriptions')
      .select('id')
      .eq('id', subId)
      .maybeSingle();
    expect(data?.id).toBe(subId);
  });

  it('9. 1 sub, 500 server error → PUSH_ALL_FAILED sin cleanup', async () => {
    const subId = await insertSub(endpoint('S9'));
    mockSendNotification.mockRejectedValue(makeWebPushError(500, 'Internal'));

    const res = await sendPushReminder({ reminder, admin, userId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('PUSH_ALL_FAILED');

    const { data } = await admin
      .from('push_subscriptions')
      .select('id')
      .eq('id', subId)
      .maybeSingle();
    expect(data?.id).toBe(subId);
  });

  it('10. payload > 4KB → body truncado defensivo + send sigue OK', async () => {
    // Reminder con titulo absurdo (>4KB). Modificamos shape para este test.
    const heavyReminder: ReminderWithEvent = {
      ...reminder,
      event: { ...reminder.event, titulo: 'X'.repeat(5000) },
    };
    await insertSub(endpoint('S10'));
    mockSendNotification.mockResolvedValue({ statusCode: 200, body: '', headers: {} });

    const res = await sendPushReminder({ reminder: heavyReminder, admin, userId });
    expect(res.ok).toBe(true);

    // Inspect payload que llegó al mock: body truncado a ≤ 201 chars + …
    const payloadJsonSent = mockSendNotification.mock.calls[0]![1] as string;
    const parsed = JSON.parse(payloadJsonSent) as { body: string };
    expect(parsed.body.length).toBeLessThanOrEqual(201);
    expect(parsed.body.endsWith('…')).toBe(true);
  });
});
