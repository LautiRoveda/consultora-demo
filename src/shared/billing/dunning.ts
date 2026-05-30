import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/env';
import { LINK_BASE } from '@/shared/notifications/email-templates/_utils';
import { renderPaymentFailedEmail } from '@/shared/notifications/email-templates/payment-failed';
import { renderSubscriptionCancelledEmail } from '@/shared/notifications/email-templates/subscription-cancelled';
import { renderTrialExpiredEmail } from '@/shared/notifications/email-templates/trial-expired';
import { renderTrialExpiresEmail } from '@/shared/notifications/email-templates/trial-expires';
import { getResendClient } from '@/shared/notifications/resend';
import { logger } from '@/shared/observability/logger';

/**
 * T-074 · Senders dunning idempotentes (email Resend).
 *
 * Flow comun (todos los senders):
 *   1. INSERT billing_notifications_log (consultora_id, tipo, ref_id) con
 *      ON CONFLICT DO NOTHING. UNIQUE compuesto con NULLS NOT DISTINCT
 *      garantiza idempotency (trial_* ref_id=null, payment/sub ref_id=mp_id).
 *   2. Si 0 filas afectadas -> ya enviado -> { sent: false, reason: 'already_sent' }.
 *   3. Render template + getResendClient().emails.send(...).
 *   4. Si error Resend -> UPDATE log row marca resend_email_id='failed' +
 *      logger.error + return { sent: false, reason: 'resend_error' }.
 *   5. Si OK -> UPDATE log row con resend_email_id=data.id + { sent: true }.
 *
 * `ownerEmail` se resuelve via `resolveConsultoraOwnerEmail`:
 *   consultora_members.role='owner' -> auth.admin.getUserById(user_id).email.
 *   Si null (consultora huerfana, edge migracion legacy) -> skip + log warn.
 *
 * CHORE-C: render+send se separa de claim. `renderAndSendDunning` se exporta
 * para que el watchdog recovery (billing-dunning-recovery) reintente rows
 * stale sin re-claim (la row ya existe con resend_email_id NULL).
 */

type DbClient = SupabaseClient<Database>;

export type DunningResult = { sent: true; emailId: string } | { sent: false; reason: string };

export type DunningTipo =
  | 'trial_expires_in_3d'
  | 'trial_expires_in_1d'
  | 'trial_expired'
  | 'payment_failed'
  | 'subscription_cancelled';

export type DunningConsultora = {
  id: string;
  name: string;
  retencionDatosHasta?: string | null;
};

export type DunningPayload =
  | undefined
  | { monto_centavos: number; razon_falla: string | null }
  | { cancelar_en: string | null };

export type DunningLogRow = {
  id: string;
  tipo: DunningTipo;
  ref_id: string | null;
};

const BILLING_URL = `${LINK_BASE}/settings/billing`;

/**
 * Resuelve el email del owner de la consultora. Si no hay owner o no se
 * puede leer el user de auth.admin -> null.
 */
export async function resolveConsultoraOwnerEmail(
  admin: DbClient,
  consultoraId: string,
): Promise<{ ownerUserId: string; ownerEmail: string } | null> {
  const { data: member, error: memberErr } = await admin
    .from('consultora_members')
    .select('user_id')
    .eq('consultora_id', consultoraId)
    .eq('role', 'owner')
    .maybeSingle();

  if (memberErr) {
    logger.warn({ consultoraId, err: memberErr }, 'resolveConsultoraOwnerEmail: query failed');
    return null;
  }
  if (!member?.user_id) {
    logger.warn({ consultoraId }, 'resolveConsultoraOwnerEmail: no owner found');
    return null;
  }

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(member.user_id);
  if (userErr || !userData?.user?.email) {
    logger.warn(
      { consultoraId, userId: member.user_id, err: userErr },
      'resolveConsultoraOwnerEmail: auth.getUserById failed',
    );
    return null;
  }

  return { ownerUserId: member.user_id, ownerEmail: userData.user.email };
}

/**
 * Claim idempotente: intenta INSERT en log con conflict. Retorna el id de
 * la row si la insercion gano la carrera, null si ya estaba enviado.
 */
async function claimLogRow(
  admin: DbClient,
  consultoraId: string,
  tipo: DunningTipo,
  refId: string | null,
): Promise<string | null> {
  const { data, error } = await admin
    .from('billing_notifications_log')
    .insert({
      consultora_id: consultoraId,
      tipo,
      ref_id: refId,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation. Conflict = ya enviado, no es error.
    if (error.code === '23505') return null;
    logger.error({ consultoraId, tipo, refId, err: error }, 'claimLogRow: insert failed');
    throw error;
  }
  return data?.id ?? null;
}

export async function markLogResendId(
  admin: DbClient,
  logId: string,
  resendEmailId: string,
): Promise<void> {
  const { error } = await admin
    .from('billing_notifications_log')
    .update({ resend_email_id: resendEmailId })
    .eq('id', logId);
  if (error) {
    logger.warn({ logId, err: error }, 'markLogResendId: update failed (non-fatal)');
  }
}

export async function markLogFailed(admin: DbClient, logId: string, reason: string): Promise<void> {
  const { error } = await admin
    .from('billing_notifications_log')
    .update({ resend_email_id: `failed:${reason.slice(0, 100)}` })
    .eq('id', logId);
  if (error) {
    logger.warn({ logId, err: error }, 'markLogFailed: update failed (non-fatal)');
  }
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
    if (!result.data?.id) {
      return { ok: false, reason: 'resend_no_id' };
    }
    return { ok: true, id: result.data.id };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

type RenderedEmail = { subject: string; html: string; text: string };

function renderDunningEmail(
  tipo: DunningTipo,
  consultora: DunningConsultora,
  payload?: DunningPayload,
): RenderedEmail {
  switch (tipo) {
    case 'trial_expires_in_3d':
      return renderTrialExpiresEmail({
        consultoraName: consultora.name,
        daysLeft: 3,
        billingUrl: BILLING_URL,
        priceCentavos: Number(env.ARS_PRICE_MONTHLY),
      });
    case 'trial_expires_in_1d':
      return renderTrialExpiresEmail({
        consultoraName: consultora.name,
        daysLeft: 1,
        billingUrl: BILLING_URL,
        priceCentavos: Number(env.ARS_PRICE_MONTHLY),
      });
    case 'trial_expired':
      return renderTrialExpiredEmail({
        consultoraName: consultora.name,
        billingUrl: BILLING_URL,
        retentionDate: consultora.retencionDatosHasta ?? null,
        priceCentavos: Number(env.ARS_PRICE_MONTHLY),
      });
    case 'payment_failed': {
      const p = payload as { monto_centavos: number; razon_falla: string | null };
      return renderPaymentFailedEmail({
        consultoraName: consultora.name,
        amountCentavos: p.monto_centavos,
        errorReason: p.razon_falla,
        billingUrl: BILLING_URL,
      });
    }
    case 'subscription_cancelled': {
      const p = payload as { cancelar_en: string | null };
      return renderSubscriptionCancelledEmail({
        consultoraName: consultora.name,
        activeUntil: p.cancelar_en,
        billingUrl: BILLING_URL,
      });
    }
  }
}

// Idempotency key debe ser identico entre cron principal y watchdog: Resend
// dedupea 24h server-side, asi que si el primer send si llego (solo crasheo
// el UPDATE local), el reintento devuelve el mismo id sin reenviar.
function buildIdempotencyKey(
  consultoraId: string,
  tipo: DunningTipo,
  refId: string | null,
): string {
  if (
    tipo === 'trial_expires_in_3d' ||
    tipo === 'trial_expires_in_1d' ||
    tipo === 'trial_expired'
  ) {
    return `${consultoraId}:${tipo}`;
  }
  return `${consultoraId}:${tipo}:${refId}`;
}

/**
 * Render + Resend.send + UPDATE log. NO hace claim. Caller garantiza
 * que `logRow` ya existe en billing_notifications_log (insertada por el
 * cron principal o por una corrida previa que crasheo entre claim y update).
 */
export async function renderAndSendDunning(
  admin: DbClient,
  logRow: DunningLogRow,
  consultora: DunningConsultora,
  ownerEmail: string,
  payload?: DunningPayload,
): Promise<DunningResult> {
  const rendered = renderDunningEmail(logRow.tipo, consultora, payload);
  const result = await sendViaResend({
    to: ownerEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: buildIdempotencyKey(consultora.id, logRow.tipo, logRow.ref_id),
  });

  if (!result.ok) {
    await markLogFailed(admin, logRow.id, result.reason);
    logger.error(
      { consultoraId: consultora.id, tipo: logRow.tipo, reason: result.reason },
      'dunning: send failed',
    );
    return { sent: false, reason: result.reason };
  }
  await markLogResendId(admin, logRow.id, result.id);
  return { sent: true, emailId: result.id };
}

export async function sendTrialExpiresIn(
  admin: DbClient,
  consultora: { id: string; name: string },
  ownerEmail: string,
  daysLeft: 3 | 1,
): Promise<DunningResult> {
  const tipo: DunningTipo = daysLeft === 3 ? 'trial_expires_in_3d' : 'trial_expires_in_1d';
  const logId = await claimLogRow(admin, consultora.id, tipo, null);
  if (!logId) return { sent: false, reason: 'already_sent' };
  return renderAndSendDunning(admin, { id: logId, tipo, ref_id: null }, consultora, ownerEmail);
}

export async function sendTrialExpired(
  admin: DbClient,
  consultora: { id: string; name: string; retencionDatosHasta: string | null },
  ownerEmail: string,
): Promise<DunningResult> {
  const tipo: DunningTipo = 'trial_expired';
  const logId = await claimLogRow(admin, consultora.id, tipo, null);
  if (!logId) return { sent: false, reason: 'already_sent' };
  return renderAndSendDunning(admin, { id: logId, tipo, ref_id: null }, consultora, ownerEmail);
}

export async function sendPaymentFailed(
  admin: DbClient,
  consultora: { id: string; name: string },
  ownerEmail: string,
  factura: {
    mp_payment_id: string;
    monto_centavos: number;
    razon_falla: string | null;
  },
): Promise<DunningResult> {
  const tipo: DunningTipo = 'payment_failed';
  const logId = await claimLogRow(admin, consultora.id, tipo, factura.mp_payment_id);
  if (!logId) return { sent: false, reason: 'already_sent' };
  return renderAndSendDunning(
    admin,
    { id: logId, tipo, ref_id: factura.mp_payment_id },
    consultora,
    ownerEmail,
    { monto_centavos: factura.monto_centavos, razon_falla: factura.razon_falla },
  );
}

export async function sendSubscriptionCancelled(
  admin: DbClient,
  consultora: { id: string; name: string },
  ownerEmail: string,
  suscripcion: {
    mp_subscription_id: string | null;
    cancelar_en: string | null;
  },
): Promise<DunningResult> {
  const tipo: DunningTipo = 'subscription_cancelled';
  const refId = suscripcion.mp_subscription_id ?? `local:${consultora.id}`;
  const logId = await claimLogRow(admin, consultora.id, tipo, refId);
  if (!logId) return { sent: false, reason: 'already_sent' };
  return renderAndSendDunning(admin, { id: logId, tipo, ref_id: refId }, consultora, ownerEmail, {
    cancelar_en: suscripcion.cancelar_en,
  });
}
