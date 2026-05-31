import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EppWeeklyResumen } from './epp-weekly-data';

import { env } from '@/env';
import { resolveConsultoraOwnerEmail } from '@/shared/billing/dunning';
import { formatDateAR } from '@/shared/lib/format-date';
import { renderEppWeeklySummaryEmail } from '@/shared/notifications/email-templates/epp-weekly-summary';
import { getResendClient } from '@/shared/notifications/resend';
import { logger } from '@/shared/observability/logger';

/**
 * T-109 · Sender del digest semanal EPP (email-only, idempotente por semana ISO).
 * Replica el flujo claim-then-send de dunning (T-074): claim en
 * notification_digest_log -> render -> Resend con idempotencyKey -> mark.
 *
 * PII (Ley 25.326): NUNCA logueamos el email en claro (logueamos consultoraId /
 * userId). El logger ademas redacta email/ownerEmail por config (C6). El `to`
 * va exclusivamente a Resend.
 */

type DbClient = SupabaseClient<Database>;

export type DigestResult = { sent: true; emailId: string } | { sent: false; reason: string };

const DIGEST_TIPO = 'epp_weekly_summary';
const DIGEST_CHANNEL = 'email';

/**
 * Preferencia de canal email del owner. Default enabled=true (mismo criterio que
 * el dispatcher de reminders: email default-on). muted si muted_until > now.
 */
async function getEmailPref(
  admin: DbClient,
  userId: string,
): Promise<{ enabled: boolean; muted: boolean }> {
  const { data } = await admin
    .from('notification_channel_prefs')
    .select('enabled, muted_until')
    .eq('user_id', userId)
    .eq('channel', 'email')
    .maybeSingle();
  const enabled = data?.enabled ?? true;
  const muted = data?.muted_until ? new Date(data.muted_until) > new Date() : false;
  return { enabled, muted };
}

/**
 * Claim idempotente: INSERT en notification_digest_log. Retorna el id si gano la
 * carrera, null si ya existia (23505 unique_violation = ya enviado esta semana).
 */
async function claimDigestLog(
  admin: DbClient,
  consultoraId: string,
  periodoIso: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('notification_digest_log')
    .insert({
      consultora_id: consultoraId,
      tipo: DIGEST_TIPO,
      periodo_iso: periodoIso,
      channel: DIGEST_CHANNEL,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return null;
    logger.error({ consultoraId, periodoIso, err: error }, 'epp-weekly: claim failed');
    throw error;
  }
  return data?.id ?? null;
}

async function markDigestResendId(
  admin: DbClient,
  logId: string,
  resendEmailId: string,
): Promise<void> {
  const { error } = await admin
    .from('notification_digest_log')
    .update({ resend_email_id: resendEmailId })
    .eq('id', logId);
  if (error) logger.warn({ logId, err: error }, 'epp-weekly: markResendId failed (non-fatal)');
}

async function markDigestFailed(admin: DbClient, logId: string, reason: string): Promise<void> {
  const { error } = await admin
    .from('notification_digest_log')
    .update({ resend_email_id: `failed:${reason.slice(0, 100)}` })
    .eq('id', logId);
  if (error) logger.warn({ logId, err: error }, 'epp-weekly: markFailed failed (non-fatal)');
}

async function sendViaResend(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const resend = getResendClient();
  try {
    const result = await resend.emails.send(
      {
        from: env.RESEND_FROM_ADDRESS,
        to: args.to,
        replyTo: env.RESEND_REPLY_TO_ADDRESS,
        subject: args.subject,
        html: args.html,
        text: args.text,
      },
      { idempotencyKey: args.idempotencyKey },
    );
    if (result.error) {
      const name = (result.error as { name?: string }).name ?? 'unknown';
      return { ok: false, reason: `resend_${name}` };
    }
    if (!result.data?.id) return { ok: false, reason: 'resend_no_id' };
    return { ok: true, id: result.data.id };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendEppWeeklySummary(
  admin: DbClient,
  consultora: { id: string; name: string },
  resumen: EppWeeklyResumen,
  periodoIso: string,
): Promise<DigestResult> {
  // (1) Owner (reusa el resolver de dunning).
  const owner = await resolveConsultoraOwnerEmail(admin, consultora.id);
  if (!owner) return { sent: false, reason: 'no_owner_email' };

  // (2) Respetar preferencia de canal email.
  const pref = await getEmailPref(admin, owner.ownerUserId);
  if (!pref.enabled || pref.muted) return { sent: false, reason: 'email_channel_off' };

  // (3) Claim idempotente -> already_sent si ya se envio esta semana.
  const logId = await claimDigestLog(admin, consultora.id, periodoIso);
  if (!logId) return { sent: false, reason: 'already_sent' };

  // (4) Render + Resend con idempotencyKey estable (dedup 24h server-side).
  const email = renderEppWeeklySummaryEmail({
    consultoraName: consultora.name,
    entregas7d: resumen.entregas7d,
    vencimientos: resumen.vencimientos7d.map((v) => ({
      empleado: v.empleado,
      item: v.item,
      fecha: formatDateAR(v.fechaIso),
    })),
  });
  const result = await sendViaResend({
    to: owner.ownerEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: `${consultora.id}:${DIGEST_TIPO}:${periodoIso}`,
  });

  // (5) Persistir outcome.
  if (!result.ok) {
    // Razon: claim-then-send PERSISTE la fila en fallo (markDigestFailed hace
    // UPDATE a 'failed:...', no DELETE) para evitar doble-envio — consistente con
    // dunning T-074 (markLogFailed). Retry recien el proximo periodo_iso: la fila
    // de esta semana queda y bloquea reenvio (no hay watchdog intra-semana para
    // un digest no critico).
    await markDigestFailed(admin, logId, result.reason);
    logger.error(
      { consultoraId: consultora.id, periodoIso, reason: result.reason },
      'epp-weekly: send failed',
    );
    return { sent: false, reason: result.reason };
  }
  await markDigestResendId(admin, logId, result.id);
  return { sent: true, emailId: result.id };
}
