import { type NextRequest } from 'next/server';

import { env } from '@/env';
import {
  resolveConsultoraOwnerEmail,
  sendTrialExpired,
  sendTrialExpiresIn,
} from '@/shared/billing/dunning';
import { logger } from '@/shared/observability/logger';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-074 · POST /api/cron/billing-notifications
 *
 * Disparado por pg_cron via pg_net (process_pending_billing_dunning).
 * Auth: header X-Internal-Cron-Secret = env.INTERNAL_CRON_SECRET.
 *
 * Lógica daily:
 *   - Bucket 3d: plan='trial' AND trial_hasta entre (now+2.5d, now+3.5d).
 *   - Bucket 1d: plan='trial' AND trial_hasta entre (now+0.5d, now+1.5d).
 *   - Bucket expired: plan='trial' AND trial_hasta entre (now-1d, now).
 *
 * Idempotency garantizada por billing_notifications_log UNIQUE constraint
 * en los senders. Re-ejecutar el mismo día = 0 emails enviados.
 *
 * Webhook hooks (payment_failed + subscription_cancelled) van por otra ruta
 * (sync desde webhooks/mercadopago/route.ts).
 */

type ErrorBody = { code: string; message: string };

function errorResponse(status: number, body: ErrorBody): Response {
  return Response.json(body, { status });
}

const DAY_MS = 24 * 60 * 60 * 1000;

type ProcessOutcome = {
  consultoraId: string;
  sent: boolean;
  reason?: string;
};

export async function POST(request: NextRequest): Promise<Response> {
  const provided = request.headers.get('X-Internal-Cron-Secret');
  if (!provided || provided !== env.INTERNAL_CRON_SECRET) {
    logger.warn({ hasHeader: Boolean(provided) }, 'billing-notifications: secret invalido');
    return errorResponse(401, {
      code: 'UNAUTHORIZED',
      message: 'X-Internal-Cron-Secret invalido o ausente',
    });
  }

  const admin = createServiceRoleClient();
  const now = new Date();

  // Bucket ranges (UTC).
  const in3dStart = new Date(now.getTime() + 2.5 * DAY_MS).toISOString();
  const in3dEnd = new Date(now.getTime() + 3.5 * DAY_MS).toISOString();
  const in1dStart = new Date(now.getTime() + 0.5 * DAY_MS).toISOString();
  const in1dEnd = new Date(now.getTime() + 1.5 * DAY_MS).toISOString();
  const expiredStart = new Date(now.getTime() - 1 * DAY_MS).toISOString();
  const expiredEnd = now.toISOString();

  const [in3dRes, in1dRes, expiredRes] = await Promise.all([
    admin
      .from('consultoras')
      .select('id, name, retencion_datos_hasta')
      .eq('plan', 'trial')
      .gte('trial_hasta', in3dStart)
      .lte('trial_hasta', in3dEnd),
    admin
      .from('consultoras')
      .select('id, name, retencion_datos_hasta')
      .eq('plan', 'trial')
      .gte('trial_hasta', in1dStart)
      .lte('trial_hasta', in1dEnd),
    admin
      .from('consultoras')
      .select('id, name, retencion_datos_hasta')
      .eq('plan', 'trial')
      .gte('trial_hasta', expiredStart)
      .lte('trial_hasta', expiredEnd),
  ]);

  const queryErrors: string[] = [];
  if (in3dRes.error) queryErrors.push(`bucket_3d: ${in3dRes.error.message}`);
  if (in1dRes.error) queryErrors.push(`bucket_1d: ${in1dRes.error.message}`);
  if (expiredRes.error) queryErrors.push(`bucket_expired: ${expiredRes.error.message}`);

  if (queryErrors.length > 0) {
    logger.error({ queryErrors }, 'billing-notifications: query errors');
    return errorResponse(500, {
      code: 'DB_ERROR',
      message: `Query errors: ${queryErrors.join('; ')}`,
    });
  }

  const in3dList = in3dRes.data ?? [];
  const in1dList = in1dRes.data ?? [];
  const expiredList = expiredRes.data ?? [];

  const outcomes: ProcessOutcome[] = [];
  const sendErrors: { consultoraId: string; tipo: string; reason: string }[] = [];

  for (const c of in3dList) {
    try {
      const ownerInfo = await resolveConsultoraOwnerEmail(admin, c.id);
      if (!ownerInfo) {
        outcomes.push({ consultoraId: c.id, sent: false, reason: 'no_owner_email' });
        continue;
      }
      const r = await sendTrialExpiresIn(
        admin,
        { id: c.id, name: c.name },
        ownerInfo.ownerEmail,
        3,
      );
      outcomes.push({ consultoraId: c.id, sent: r.sent, reason: r.sent ? undefined : r.reason });
      if (!r.sent && r.reason !== 'already_sent') {
        sendErrors.push({ consultoraId: c.id, tipo: 'trial_expires_in_3d', reason: r.reason });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      sendErrors.push({ consultoraId: c.id, tipo: 'trial_expires_in_3d', reason });
      outcomes.push({ consultoraId: c.id, sent: false, reason });
    }
  }

  for (const c of in1dList) {
    try {
      const ownerInfo = await resolveConsultoraOwnerEmail(admin, c.id);
      if (!ownerInfo) {
        outcomes.push({ consultoraId: c.id, sent: false, reason: 'no_owner_email' });
        continue;
      }
      const r = await sendTrialExpiresIn(
        admin,
        { id: c.id, name: c.name },
        ownerInfo.ownerEmail,
        1,
      );
      outcomes.push({ consultoraId: c.id, sent: r.sent, reason: r.sent ? undefined : r.reason });
      if (!r.sent && r.reason !== 'already_sent') {
        sendErrors.push({ consultoraId: c.id, tipo: 'trial_expires_in_1d', reason: r.reason });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      sendErrors.push({ consultoraId: c.id, tipo: 'trial_expires_in_1d', reason });
      outcomes.push({ consultoraId: c.id, sent: false, reason });
    }
  }

  for (const c of expiredList) {
    try {
      const ownerInfo = await resolveConsultoraOwnerEmail(admin, c.id);
      if (!ownerInfo) {
        outcomes.push({ consultoraId: c.id, sent: false, reason: 'no_owner_email' });
        continue;
      }
      const r = await sendTrialExpired(
        admin,
        { id: c.id, name: c.name, retencionDatosHasta: c.retencion_datos_hasta },
        ownerInfo.ownerEmail,
      );
      outcomes.push({ consultoraId: c.id, sent: r.sent, reason: r.sent ? undefined : r.reason });
      if (!r.sent && r.reason !== 'already_sent') {
        sendErrors.push({ consultoraId: c.id, tipo: 'trial_expired', reason: r.reason });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      sendErrors.push({ consultoraId: c.id, tipo: 'trial_expired', reason });
      outcomes.push({ consultoraId: c.id, sent: false, reason });
    }
  }

  const processed = outcomes.length;
  const sent = outcomes.filter((o) => o.sent).length;
  const skipped = outcomes.filter((o) => !o.sent && o.reason === 'already_sent').length;

  logger.info(
    {
      processed,
      sent,
      skipped,
      errors: sendErrors.length,
      buckets: { in3d: in3dList.length, in1d: in1dList.length, expired: expiredList.length },
    },
    'billing-notifications: completed',
  );

  return Response.json({ processed, sent, skipped, errors: sendErrors }, { status: 200 });
}
