/**
 * T-031 · Tests del route handler POST /api/calendar/dispatch-reminder.
 *
 * Cobertura:
 *  1. POST sin header X-Internal-Cron-Secret → 401.
 *  2. POST con header invalido → 401.
 *  3. POST con body no-JSON → 400.
 *  4. POST con reminder_id no UUID → 400.
 *  5. POST con reminder_id inexistente → 404.
 *  6. POST happy path → 200 + notification_log row con status=sent +
 *     provider_message_id.
 *  7. Event cancelled → 200 + log row skipped EVENT_NOT_PENDING.
 *  8. Event sin created_by → 200 + log row skipped NO_RECIPIENT (ajuste 3
 *     del plan).
 *  9. Idempotency capa 3: 2 POSTs consecutivos → segundo skipea
 *     ALREADY_SENT.
 * 10. Resend devuelve error → log row status=failed con error_code.
 *
 * Mocks:
 *  - server-only: stub.
 *  - @/shared/notifications/resend: factory que devuelve cliente con
 *    `emails.send` mockeado. Preserva error classes reales del SDK
 *    importadas como `Resend` (patron T-020 con Anthropic).
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
const slug = `t031-disp-${runId}`;
const emailOwner = `t031-disp-owner-${runId}@example.com`;
const password = 'TestPassword123!';

let cId: string;
let ownerId: string;
let eventPendingId: string;
let eventCancelledId: string;
let reminderPendingId: string;
let reminderCancelledId: string;
let reminderForOrphanEventId: string;

function isoDaysAhead(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function makeRequest(opts: { body: unknown; secret?: string | null }): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.secret !== null) {
    headers['X-Internal-Cron-Secret'] = opts.secret ?? env.INTERNAL_CRON_SECRET;
  }
  return new NextRequest('http://localhost/api/calendar/dispatch-reminder', {
    method: 'POST',
    headers,
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
}

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T031 disp', slug })
    .select('id')
    .single();
  cId = c!.id;

  const { data: u } = await admin.auth.admin.createUser({
    email: emailOwner,
    password,
    email_confirm: true,
  });
  ownerId = u.user!.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: cId, role: 'owner' });

  await admin.auth.admin.updateUserById(ownerId, {
    app_metadata: { consultora_id: cId },
  });

  // Event pending.
  const { data: eP } = await admin
    .from('calendar_events')
    .insert({
      consultora_id: cId,
      tipo: 'custom',
      titulo: 'Dispatch test PENDING',
      fecha_vencimiento: isoDaysAhead(7),
      reminder_offsets_days: [7, 0],
      status: 'pending',
      created_by: ownerId,
    })
    .select('id')
    .single();
  eventPendingId = eP!.id;

  // Event cancelled.
  const { data: eX } = await admin
    .from('calendar_events')
    .insert({
      consultora_id: cId,
      tipo: 'custom',
      titulo: 'Dispatch test CANCELLED',
      fecha_vencimiento: isoDaysAhead(7),
      reminder_offsets_days: [7, 0],
      status: 'cancelled',
      created_by: ownerId,
    })
    .select('id')
    .single();
  eventCancelledId = eX!.id;

  // Event orphan (created_by se borra despues del insert).
  const orphanEmail = `t031-orphan-${runId}@example.com`;
  const { data: uOrphan } = await admin.auth.admin.createUser({
    email: orphanEmail,
    password,
    email_confirm: true,
  });
  const orphanUserId = uOrphan.user!.id;
  await admin
    .from('consultora_members')
    .insert({ user_id: orphanUserId, consultora_id: cId, role: 'member' });
  const { data: eOrphan } = await admin
    .from('calendar_events')
    .insert({
      consultora_id: cId,
      tipo: 'custom',
      titulo: 'Dispatch test ORPHAN',
      fecha_vencimiento: isoDaysAhead(7),
      reminder_offsets_days: [7, 0],
      status: 'pending',
      created_by: orphanUserId,
    })
    .select('id')
    .single();
  const { data: rOrphan } = await admin
    .from('calendar_event_reminders')
    .insert({
      event_id: eOrphan!.id,
      consultora_id: cId,
      offset_days: 0,
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .select('id')
    .single();
  reminderForOrphanEventId = rOrphan!.id;
  // Borrar el user: on delete set null en created_by deja al event sin user.
  await admin.auth.admin.deleteUser(orphanUserId);

  // Reminder fixture para event pending.
  const { data: rP } = await admin
    .from('calendar_event_reminders')
    .insert({
      event_id: eventPendingId,
      consultora_id: cId,
      offset_days: 7,
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .select('id')
    .single();
  reminderPendingId = rP!.id;

  // Reminder fixture para event cancelled.
  const { data: rX } = await admin
    .from('calendar_event_reminders')
    .insert({
      event_id: eventCancelledId,
      consultora_id: cId,
      offset_days: 7,
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .select('id')
    .single();
  reminderCancelledId = rX!.id;
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(ownerId).catch(() => {});
});

beforeEach(() => {
  mockEmailsSend.mockReset();
});

describe('POST /api/calendar/dispatch-reminder · auth', () => {
  it('1. sin header X-Internal-Cron-Secret -> 401', async () => {
    const req = makeRequest({ body: { reminder_id: reminderPendingId }, secret: null });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('2. header invalido -> 401', async () => {
    const req = makeRequest({
      body: { reminder_id: reminderPendingId },
      secret: 'wrong-secret',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/calendar/dispatch-reminder · input validation', () => {
  it('3. body no-JSON -> 400 INVALID_INPUT', async () => {
    const req = new NextRequest('http://localhost/api/calendar/dispatch-reminder', {
      method: 'POST',
      headers: {
        'X-Internal-Cron-Secret': env.INTERNAL_CRON_SECRET,
        'Content-Type': 'application/json',
      },
      body: 'no es json {{{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('4. reminder_id no UUID -> 400', async () => {
    const req = makeRequest({ body: { reminder_id: 'not-a-uuid' } });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('5. reminder_id UUID inexistente -> 404', async () => {
    const req = makeRequest({
      body: { reminder_id: '00000000-0000-0000-0000-000000000000' },
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/calendar/dispatch-reminder · happy path + defenses', () => {
  it('6. happy path: event pending + resend OK -> 200 + log sent', async () => {
    mockEmailsSend.mockResolvedValueOnce({
      data: { id: 'rsd_test_happy' },
      error: null,
    });

    const req = makeRequest({ body: { reminder_id: reminderPendingId } });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reminder_id).toBe(reminderPendingId);

    // Resend fue llamado.
    expect(mockEmailsSend).toHaveBeenCalledOnce();
    const sendArgs = mockEmailsSend.mock.calls[0]![0];
    expect(sendArgs.to).toBe(emailOwner);
    expect(sendArgs.subject).toContain('Vence en 7 días');
    expect(sendArgs.html).toBeTruthy();
    expect(sendArgs.text).toBeTruthy();

    // notification_log row insertada.
    const { data: logs } = await admin
      .from('notification_log')
      .select('channel, status, provider_message_id, error_code')
      .eq('reminder_id', reminderPendingId);
    const emailLog = logs?.find((r) => r.channel === 'email');
    expect(emailLog?.status).toBe('sent');
    expect(emailLog?.provider_message_id).toBe('rsd_test_happy');
    expect(emailLog?.error_code).toBeNull();
  });

  it('7. event cancelled -> 200 + log skipped EVENT_NOT_PENDING', async () => {
    const req = makeRequest({ body: { reminder_id: reminderCancelledId } });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channels[0].status).toBe('skipped');
    expect(body.channels[0].error_code).toBe('EVENT_NOT_PENDING');

    // Resend NO fue llamado.
    expect(mockEmailsSend).not.toHaveBeenCalled();

    const { data: logs } = await admin
      .from('notification_log')
      .select('status, error_code')
      .eq('reminder_id', reminderCancelledId);
    expect(logs).toHaveLength(1);
    expect(logs![0]!.status).toBe('skipped');
    expect(logs![0]!.error_code).toBe('EVENT_NOT_PENDING');
  });

  it('8. event.created_by IS NULL -> 200 + log skipped NO_RECIPIENT', async () => {
    const req = makeRequest({ body: { reminder_id: reminderForOrphanEventId } });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channels[0].status).toBe('skipped');
    expect(body.channels[0].error_code).toBe('NO_RECIPIENT');

    expect(mockEmailsSend).not.toHaveBeenCalled();

    const { data: logs } = await admin
      .from('notification_log')
      .select('status, error_code, error_detail')
      .eq('reminder_id', reminderForOrphanEventId);
    expect(logs).toHaveLength(1);
    expect(logs![0]!.status).toBe('skipped');
    expect(logs![0]!.error_code).toBe('NO_RECIPIENT');
    expect(logs![0]!.error_detail).toContain('created_by IS NULL');
  });
});

describe('POST /api/calendar/dispatch-reminder · idempotency capa 3', () => {
  it('9. 2 POSTs consecutivos con mismo reminder_id -> segundo skipea ALREADY_SENT', async () => {
    // Crear reminder fresco para este test (no contaminado por test 6).
    const { data: rFresh } = await admin
      .from('calendar_event_reminders')
      .insert({
        event_id: eventPendingId,
        consultora_id: cId,
        offset_days: 14,
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .select('id')
      .single();
    const reminderId = rFresh!.id;

    mockEmailsSend.mockResolvedValueOnce({
      data: { id: 'rsd_idemp_1' },
      error: null,
    });

    // Primer POST.
    const req1 = makeRequest({ body: { reminder_id: reminderId } });
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.channels[0].status).toBe('sent');
    expect(mockEmailsSend).toHaveBeenCalledTimes(1);

    // Segundo POST: el sender NO debe ser llamado nuevamente (idempotency).
    const req2 = makeRequest({ body: { reminder_id: reminderId } });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.channels[0].status).toBe('skipped');
    expect(body2.channels[0].error_code).toBe('ALREADY_SENT');

    // Resend mockeado sigue en 1 llamada (no se incremento).
    expect(mockEmailsSend).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/calendar/dispatch-reminder · Resend errors', () => {
  it('10. Resend devuelve error -> log row status=failed con error_code', async () => {
    const { data: rFresh } = await admin
      .from('calendar_event_reminders')
      .insert({
        event_id: eventPendingId,
        consultora_id: cId,
        offset_days: 21,
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .select('id')
      .single();
    const reminderId = rFresh!.id;

    mockEmailsSend.mockResolvedValueOnce({
      data: null,
      error: {
        name: 'validation_error',
        message: 'Invalid recipient address',
      },
    });

    const req = makeRequest({ body: { reminder_id: reminderId } });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channels[0].status).toBe('failed');
    expect(body.channels[0].error_code).toBe('RESEND_VALIDATION_ERROR');

    const { data: logs } = await admin
      .from('notification_log')
      .select('status, error_code, error_detail')
      .eq('reminder_id', reminderId);
    const emailLog = logs?.find(
      (r) => r.status === 'failed' && r.error_code === 'RESEND_VALIDATION_ERROR',
    );
    expect(emailLog).toBeTruthy();
    expect(emailLog?.error_detail).toBe('Invalid recipient address');
  });
});
