import type { DunningLogRow, DunningPayload, DunningTipo } from '@/shared/billing/dunning';
import { type NextRequest } from 'next/server';

import { env } from '@/env';
import {
  markLogFailed,
  renderAndSendDunning,
  resolveConsultoraOwnerEmail,
} from '@/shared/billing/dunning';
import { logger } from '@/shared/observability/logger';
import { constantTimeEqual } from '@/shared/security/timing-safe';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * CHORE-C · POST /api/cron/billing-dunning-recovery
 *
 * Watchdog para rows stale en billing_notifications_log. El cron principal
 * (process_pending_billing_dunning) hace claim+send+update en 3 pasos; si
 * el proceso muere entre claim y update, queda resend_email_id NULL y el
 * UNIQUE bloquea cualquier reintento.
 *
 * Este endpoint busca rows con resend_email_id IS NULL + created_at >
 * 5 min (gracia para no pisar al cron principal que recien hizo claim) y
 * las reintenta. Resend dedupea 24h por idempotencyKey, asi que si el
 * primer send si llego (solo crasheo el UPDATE local), no se duplica.
 *
 * Disparado por pg_cron via pg_net (process_dunning_recovery) cada 15 min.
 * Auth: header X-Internal-Cron-Secret = env.INTERNAL_CRON_SECRET.
 */

const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const RECOVERY_BATCH_LIMIT = 50;
const ERROR_SAMPLE_LIMIT = 10;

type ErrorBody = { code: string; message: string };

function errorResponse(status: number, body: ErrorBody): Response {
  return Response.json(body, { status });
}

type StaleRow = {
  id: string;
  consultora_id: string;
  tipo: DunningTipo;
  ref_id: string | null;
  created_at: string;
};

type RecoveryError = {
  logId: string;
  tipo: DunningTipo;
  reason: string;
};

export async function POST(request: NextRequest): Promise<Response> {
  const provided = request.headers.get('X-Internal-Cron-Secret');
  if (!constantTimeEqual(provided, env.INTERNAL_CRON_SECRET)) {
    logger.warn({ hasHeader: Boolean(provided) }, 'billing-dunning-recovery: secret invalido');
    return errorResponse(401, {
      code: 'UNAUTHORIZED',
      message: 'X-Internal-Cron-Secret invalido o ausente',
    });
  }

  const admin = createServiceRoleClient();
  const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

  const { data: staleRows, error: staleErr } = await admin
    .from('billing_notifications_log')
    .select('id, consultora_id, tipo, ref_id, created_at')
    .is('resend_email_id', null)
    .lt('created_at', staleCutoff)
    .order('created_at', { ascending: true })
    .limit(RECOVERY_BATCH_LIMIT);

  if (staleErr) {
    logger.error({ err: staleErr }, 'billing-dunning-recovery: stale query failed');
    return errorResponse(500, {
      code: 'DB_ERROR',
      message: `Stale rows query failed: ${staleErr.message}`,
    });
  }

  const rows = (staleRows ?? []) as StaleRow[];
  const found = rows.length;
  let recovered = 0;
  let failed = 0;
  const errors: RecoveryError[] = [];

  for (const row of rows) {
    try {
      const logRow: DunningLogRow = { id: row.id, tipo: row.tipo, ref_id: row.ref_id };

      const { data: consultora, error: cErr } = await admin
        .from('consultoras')
        .select('id, name, retencion_datos_hasta')
        .eq('id', row.consultora_id)
        .maybeSingle();

      if (cErr) {
        await markLogFailed(admin, row.id, `db_consultora_${cErr.code ?? 'unknown'}`);
        failed += 1;
        if (errors.length < ERROR_SAMPLE_LIMIT) {
          errors.push({ logId: row.id, tipo: row.tipo, reason: 'db_consultora_query_failed' });
        }
        continue;
      }

      // Defensive: FK billing_notifications_log.consultora_id tiene ON DELETE
      // CASCADE, asi que esta rama es unreachable hoy. Cableada forward para
      // el dia que consultoras pase a soft-delete (CHORE-D-FU o T-Compliance).
      if (!consultora) {
        await markLogFailed(admin, row.id, 'consultora_deleted');
        failed += 1;
        if (errors.length < ERROR_SAMPLE_LIMIT) {
          errors.push({ logId: row.id, tipo: row.tipo, reason: 'consultora_deleted' });
        }
        continue;
      }

      const ownerInfo = await resolveConsultoraOwnerEmail(admin, row.consultora_id);
      if (!ownerInfo) {
        await markLogFailed(admin, row.id, 'no_owner_email');
        failed += 1;
        if (errors.length < ERROR_SAMPLE_LIMIT) {
          errors.push({ logId: row.id, tipo: row.tipo, reason: 'no_owner_email' });
        }
        continue;
      }

      const payload = await loadPayloadForTipo(admin, row);
      if (payload.kind === 'not_found') {
        await markLogFailed(admin, row.id, 'ref_not_found');
        failed += 1;
        if (errors.length < ERROR_SAMPLE_LIMIT) {
          errors.push({ logId: row.id, tipo: row.tipo, reason: 'ref_not_found' });
        }
        continue;
      }

      const result = await renderAndSendDunning(
        admin,
        logRow,
        {
          id: consultora.id,
          name: consultora.name,
          retencionDatosHasta: consultora.retencion_datos_hasta,
        },
        ownerInfo.ownerEmail,
        payload.value,
      );

      if (result.sent) {
        recovered += 1;
      } else {
        failed += 1;
        if (errors.length < ERROR_SAMPLE_LIMIT) {
          errors.push({ logId: row.id, tipo: row.tipo, reason: result.reason });
        }
      }
    } catch (err) {
      // No leak de detalles externos del error en el response — usamos un
      // tag generico, los detalles van al logger structured.
      logger.error({ logId: row.id, tipo: row.tipo, err }, 'billing-dunning-recovery: row crashed');
      await markLogFailed(admin, row.id, 'recovery_exception').catch(() => {});
      failed += 1;
      if (errors.length < ERROR_SAMPLE_LIMIT) {
        errors.push({ logId: row.id, tipo: row.tipo, reason: 'recovery_exception' });
      }
    }
  }

  logger.info(
    { found, recovered, failed, errors: errors.length },
    'billing-dunning-recovery: completed',
  );

  return Response.json({ found, recovered, failed, errors }, { status: 200 });
}

type PayloadLookup = { kind: 'ok'; value: DunningPayload } | { kind: 'not_found' };

async function loadPayloadForTipo(
  admin: ReturnType<typeof createServiceRoleClient>,
  row: StaleRow,
): Promise<PayloadLookup> {
  switch (row.tipo) {
    case 'trial_expires_in_3d':
    case 'trial_expires_in_1d':
    case 'trial_expired':
      return { kind: 'ok', value: undefined };

    case 'payment_failed': {
      if (!row.ref_id) return { kind: 'not_found' };
      const { data: factura } = await admin
        .from('facturas')
        .select('monto_centavos, razon_falla')
        .eq('mp_payment_id', row.ref_id)
        .maybeSingle();
      if (!factura) return { kind: 'not_found' };
      return {
        kind: 'ok',
        value: { monto_centavos: factura.monto_centavos, razon_falla: factura.razon_falla },
      };
    }

    case 'subscription_cancelled': {
      // Asuncion: 1 consultora <-> 1 suscripcion activa. Si en el futuro el
      // modelo pasa a m2m, este .maybeSingle() rompera con multiple_rows y
      // hay que cambiar a query mas especifica.
      const query = row.ref_id?.startsWith('local:')
        ? admin
            .from('suscripciones')
            .select('cancelar_en')
            .eq('consultora_id', row.consultora_id)
            .maybeSingle()
        : admin
            .from('suscripciones')
            .select('cancelar_en')
            .eq('mp_subscription_id', row.ref_id ?? '')
            .maybeSingle();
      const { data: suscripcion } = await query;
      if (!suscripcion) return { kind: 'not_found' };
      return { kind: 'ok', value: { cancelar_en: suscripcion.cancelar_en } };
    }
  }
}
