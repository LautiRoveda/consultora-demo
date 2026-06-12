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

/**
 * T-142 · Sender transaccional genérico (welcome y futuros mails one-shot).
 *
 * A diferencia de `sendEmailReminder` (atado a `ReminderWithEvent`) y de los
 * senders dunning (con idempotency key + log table), este recibe el render ya
 * armado y dispara sin idempotency: para mails one-shot el caller garantiza la
 * unicidad del disparo (ej. el welcome sale una vez, gateado por el token de
 * confirmación single-use). `from`/`replyTo` desde env, igual que el resto.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const resend = getResendClient();
  try {
    const result = await resend.emails.send({
      from: env.RESEND_FROM_ADDRESS,
      to: args.to,
      replyTo: env.RESEND_REPLY_TO_ADDRESS,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    if (result.error) {
      const name = (result.error as { name?: string }).name ?? 'unknown';
      return { ok: false, reason: `resend_${name}` };
    }
    if (!result.data?.id) {
      return { ok: false, reason: 'resend_no_id' };
    }
    return { ok: true, id: result.data.id };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
