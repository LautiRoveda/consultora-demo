import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelOutcome, DispatchResult, ReminderWithEvent } from './types';

import { sendEmailReminder } from './senders/email';
import { sendPushReminder } from './senders/push';
import { sendTelegramReminder } from './senders/telegram';

const CHANNELS = ['email', 'telegram', 'push'] as const;
type Channel = (typeof CHANNELS)[number];

type ChannelPref = {
  channel: string;
  enabled: boolean;
  muted_until: string | null;
};

/**
 * T-031 · Orquestador de envio multi-canal para un reminder.
 *
 * Para cada canal (email/telegram/push):
 * 1. Lee preferencia del user. Si enabled=false o muted -> skip, NO loguea
 *    notification_log (el user ya decidio que no queria ese canal; ruido).
 * 2. Idempotency capa 3: chequea notification_log por (reminder, channel,
 *    status='sent'). Si ya hubo envio OK -> skip + log row con
 *    error_code=ALREADY_SENT.
 * 3. Invoca sender. Inserta fila a notification_log con outcome.
 *
 * Senders en serie: 3 canales * 1 user, paralelizar no aporta y complica
 * error handling.
 *
 * Stubs T-033/T-034: el sender devuelve {ok:false, errorCode:'NO_CHANNEL_IMPL_T0XX'}.
 * El dispatcher mapea esto a status='skipped' (no es failure, es expected).
 */
export async function dispatchReminderToChannels(args: {
  admin: SupabaseClient<Database>;
  reminder: ReminderWithEvent;
  recipient: { email: string | null; name: string | null; userId: string | null };
  prefs: ChannelPref[];
}): Promise<ChannelOutcome[]> {
  const { admin, reminder, recipient, prefs } = args;
  const outcomes: ChannelOutcome[] = [];
  const now = new Date();

  for (const channel of CHANNELS) {
    const outcome = await dispatchOneChannel({
      channel,
      admin,
      reminder,
      recipient,
      prefs,
      now,
    });
    outcomes.push(outcome);
  }

  return outcomes;
}

async function dispatchOneChannel(args: {
  channel: Channel;
  admin: SupabaseClient<Database>;
  reminder: ReminderWithEvent;
  recipient: { email: string | null; name: string | null; userId: string | null };
  prefs: ChannelPref[];
  now: Date;
}): Promise<ChannelOutcome> {
  const { channel, admin, reminder, recipient, prefs, now } = args;

  const pref = prefs.find((p) => p.channel === channel);
  // Default: email habilitado (defensa si el trigger backfill no corrio
  // por alguna razon historica). Telegram + Push default disabled.
  const enabled = pref?.enabled ?? channel === 'email';
  const muted = pref?.muted_until ? new Date(pref.muted_until) > now : false;

  if (!enabled) {
    return { channel, status: 'skipped', error_code: 'DISABLED' };
  }
  if (muted) {
    return { channel, status: 'skipped', error_code: 'MUTED' };
  }

  // Idempotency capa 3.
  const { data: existing } = await admin
    .from('notification_log')
    .select('id')
    .eq('reminder_id', reminder.id)
    .eq('channel', channel)
    .eq('status', 'sent')
    .maybeSingle();

  if (existing) {
    return { channel, status: 'skipped', error_code: 'ALREADY_SENT' };
  }

  // Sender.
  let result: DispatchResult;
  if (channel === 'email') {
    if (!recipient.email) {
      result = {
        ok: false,
        errorCode: 'NO_RECIPIENT_EMAIL',
        errorDetail: 'recipient.email es null',
      };
    } else {
      result = await sendEmailReminder({
        to: recipient.email,
        recipientName: recipient.name,
        reminder,
      });
    }
  } else if (channel === 'telegram') {
    result = await sendTelegramReminder();
  } else {
    result = await sendPushReminder();
  }

  // Persist + outcome.
  const finalStatus: 'sent' | 'skipped' | 'failed' = result.ok
    ? 'sent'
    : result.errorCode.startsWith('NO_CHANNEL_IMPL')
      ? 'skipped'
      : 'failed';

  await admin.from('notification_log').insert({
    consultora_id: reminder.event.consultora_id,
    reminder_id: reminder.id,
    event_id: reminder.event.id,
    recipient_user_id: recipient.userId,
    channel,
    status: finalStatus,
    provider_message_id: result.ok ? result.messageId : null,
    error_code: result.ok ? null : result.errorCode,
    error_detail: result.ok ? null : (result.errorDetail ?? null),
  });

  if (result.ok) {
    return { channel, status: 'sent', message_id: result.messageId };
  }
  return {
    channel,
    status: finalStatus,
    error_code: result.errorCode,
  };
}
