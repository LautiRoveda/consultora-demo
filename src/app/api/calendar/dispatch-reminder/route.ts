import type { ReminderWithEvent } from '@/shared/notifications/types';
import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { env } from '@/env';
import { dispatchReminderToChannels } from '@/shared/notifications/dispatch';
import { logger } from '@/shared/observability/logger';
import { constantTimeEqual } from '@/shared/security/timing-safe';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-031 · POST /api/calendar/dispatch-reminder
 *
 * Endpoint disparado por pg_cron via pg_net (NOT por el usuario). Recibe
 * un reminder_id, busca contexto (event + recipient + prefs) y orquesta
 * envio a los canales habilitados (email real, telegram/push stubs).
 *
 * Auth: header `X-Internal-Cron-Secret` debe matchear env var
 * `INTERNAL_CRON_SECRET` (mismo valor que el secret de Vault).
 *
 * Idempotency (capas 3 + 4 del stack discovery 7.4):
 * - El dispatcher chequea notification_log antes de emitir por canal.
 * - El sender pasa reminder.id como idempotencyKey a Resend.
 *
 * Defensas:
 * - Event ya no pending (cancelled/completed entre claim y aca) -> log
 *   skipped EVENT_NOT_PENDING + 200.
 * - event.created_by IS NULL (user deleto su cuenta) -> log skipped
 *   NO_RECIPIENT + 200.
 * - Reminder no existe -> 404.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  reminder_id: z.string().regex(UUID_REGEX, 'reminder_id debe ser UUID'),
});

type ErrorBody = { code: string; message: string };

function errorResponse(status: number, body: ErrorBody): Response {
  return Response.json(body, { status });
}

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Auth via shared secret (constant-time compare — C1 audit).
  const provided = request.headers.get('X-Internal-Cron-Secret');
  if (!constantTimeEqual(provided, env.INTERNAL_CRON_SECRET)) {
    logger.warn({ hasHeader: Boolean(provided) }, 'dispatch-reminder: secret invalido');
    return errorResponse(401, {
      code: 'UNAUTHORIZED',
      message: 'X-Internal-Cron-Secret invalido o ausente',
    });
  }

  // 2. Parse body.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(400, {
      code: 'INVALID_INPUT',
      message: 'Body no es JSON valido',
    });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse(400, {
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'reminder_id requerido',
    });
  }
  const { reminder_id } = parsed.data;

  const admin = createServiceRoleClient();

  // 3. Load reminder + event embebido.
  const { data: reminder, error: reminderError } = await admin
    .from('calendar_event_reminders')
    .select(
      `
      id,
      offset_days,
      event:calendar_events!inner (
        id,
        titulo,
        tipo,
        fecha_vencimiento,
        descripcion,
        status,
        recurrence_months,
        created_by,
        consultora_id
      )
    `,
    )
    .eq('id', reminder_id)
    .maybeSingle();

  if (reminderError) {
    logger.error(
      { reminder_id, err: reminderError },
      'dispatch-reminder: error al cargar reminder',
    );
    return errorResponse(500, {
      code: 'DB_ERROR',
      message: 'Error al cargar reminder',
    });
  }
  if (!reminder) {
    return errorResponse(404, {
      code: 'NOT_FOUND',
      message: `Reminder ${reminder_id} no encontrado`,
    });
  }

  // Supabase embebe event como objeto cuando hay !inner + foreign key. El
  // type generado puede dar array | object segun el cliente; lo
  // estrechamos defensivo.
  const event = (Array.isArray(reminder.event) ? reminder.event[0] : reminder.event) as
    | ReminderWithEvent['event']
    | undefined;

  if (!event) {
    logger.error({ reminder_id }, 'dispatch-reminder: event no embebido');
    return errorResponse(500, {
      code: 'DB_ERROR',
      message: 'Event no encontrado',
    });
  }

  // 4. Defensa: event ya no pending.
  if (event.status !== 'pending') {
    await admin.from('notification_log').insert({
      consultora_id: event.consultora_id,
      reminder_id: reminder.id,
      event_id: event.id,
      recipient_user_id: event.created_by,
      channel: 'email',
      status: 'skipped',
      error_code: 'EVENT_NOT_PENDING',
      error_detail: `event.status=${event.status}`,
    });
    logger.info(
      { reminder_id, event_id: event.id, status: event.status },
      'dispatch-reminder: event no pending, skip',
    );
    return Response.json(
      {
        reminder_id,
        channels: [{ channel: 'email', status: 'skipped', error_code: 'EVENT_NOT_PENDING' }],
      },
      { status: 200 },
    );
  }

  // 5. Defensa: event.created_by IS NULL (user deleted?).
  if (!event.created_by) {
    await admin.from('notification_log').insert({
      consultora_id: event.consultora_id,
      reminder_id: reminder.id,
      event_id: event.id,
      recipient_user_id: null,
      channel: 'email',
      status: 'skipped',
      error_code: 'NO_RECIPIENT',
      error_detail: 'event.created_by IS NULL (user deleted?)',
    });
    logger.warn(
      { reminder_id, event_id: event.id },
      'dispatch-reminder: event sin created_by, skip',
    );
    return Response.json(
      {
        reminder_id,
        channels: [{ channel: 'email', status: 'skipped', error_code: 'NO_RECIPIENT' }],
      },
      { status: 200 },
    );
  }

  // 6. Load channel prefs del recipient.
  const { data: prefs } = await admin
    .from('notification_channel_prefs')
    .select('channel, enabled, muted_until')
    .eq('user_id', event.created_by);

  // 7. Load email + name del recipient via auth.admin.
  const { data: userData } = await admin.auth.admin.getUserById(event.created_by);
  const recipientEmail = userData?.user?.email ?? null;
  const recipientName =
    (userData?.user?.user_metadata as { full_name?: string } | null)?.full_name ?? null;

  // 8. Delegate al dispatcher puro.
  const channelOutcomes = await dispatchReminderToChannels({
    admin,
    reminder: {
      id: reminder.id,
      offset_days: reminder.offset_days,
      event,
    },
    recipient: {
      email: recipientEmail,
      name: recipientName,
      userId: event.created_by,
    },
    prefs: prefs ?? [],
  });

  logger.info(
    {
      reminder_id,
      event_id: event.id,
      consultora_id: event.consultora_id,
      channels: channelOutcomes,
    },
    'dispatch-reminder: completado',
  );

  return Response.json({ reminder_id, channels: channelOutcomes }, { status: 200 });
}
