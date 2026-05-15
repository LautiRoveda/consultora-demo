import 'server-only';

import type { DispatchResult, ReminderWithEvent } from '../types';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';

import { renderReminderEmail } from '../email-templates/reminder-vencimiento';
import { getResendClient } from '../resend';

/**
 * T-031 · Sender de email via Resend.
 *
 * Idempotency capa 4: pasa `reminder.id` como `idempotencyKey` al SDK. Si
 * la request se reintenta (defensiva contra bug del cron), Resend deduplica
 * del lado provider (ventana 24h por default).
 *
 * Reply-To: leido de env (default sensato). Lautaro overridea en EasyPanel
 * si quiere reply-to especifico.
 */
export async function sendEmailReminder(args: {
  to: string;
  recipientName: string | null;
  reminder: ReminderWithEvent;
}): Promise<DispatchResult> {
  const rendered = renderReminderEmail({
    reminder: args.reminder,
    recipientName: args.recipientName,
  });

  const resend = getResendClient();

  try {
    const result = await resend.emails.send(
      {
        from: env.RESEND_FROM_ADDRESS,
        to: args.to,
        replyTo: env.RESEND_REPLY_TO_ADDRESS,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      },
      { idempotencyKey: args.reminder.id },
    );

    if (result.error) {
      logger.warn({ reminder_id: args.reminder.id, err: result.error }, 'Resend devolvio error');
      const errorName = (result.error as { name?: string }).name ?? 'unknown';
      return {
        ok: false,
        errorCode: `RESEND_${errorName.toUpperCase()}`,
        errorDetail: result.error.message,
      };
    }

    if (!result.data?.id) {
      return {
        ok: false,
        errorCode: 'RESEND_NO_ID',
        errorDetail: 'Resend devolvio sin error pero sin data.id',
      };
    }

    return { ok: true, messageId: result.data.id };
  } catch (err) {
    logger.error({ reminder_id: args.reminder.id, err }, 'sendEmailReminder threw');
    return {
      ok: false,
      errorCode: 'RESEND_EXCEPTION',
      errorDetail: err instanceof Error ? err.message : String(err),
    };
  }
}
