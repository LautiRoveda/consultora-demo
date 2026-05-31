import { type NextRequest } from 'next/server';

import { env } from '@/env';
import { isoWeekId } from '@/shared/lib/iso-week';
import { sendEppWeeklySummary } from '@/shared/notifications/digests/epp-weekly';
import {
  armarResumenEpp,
  resolverConsultorasConActividad,
  resumenEsAccionable,
} from '@/shared/notifications/digests/epp-weekly-data';
import { logger } from '@/shared/observability/logger';
import { constantTimeEqual } from '@/shared/security/timing-safe';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-109 · POST /api/cron/weekly-summary
 *
 * Disparado por pg_cron via pg_net (process_epp_weekly_summary), lunes 09:00 ART.
 * Auth: header X-Internal-Cron-Secret = env.INTERNAL_CRON_SECRET (timing-safe).
 *
 * Por cada consultora con actividad EPP en la ventana de 7d arma un resumen y,
 * si es accionable (predicado "no email vacio": >=1 entrega firmada en 7d O >=1
 * vencimiento en los proximos 7d), manda el digest por email (idempotente por
 * semana ISO via notification_digest_log).
 *
 * Service role -> BYPASSA RLS: la capa de datos (epp-weekly-data) filtra
 * consultora_id EXPLICITO en cada query. Sin esa defensa habria leak cross-tenant.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type ErrorBody = { code: string; message: string };

function errorResponse(status: number, body: ErrorBody): Response {
  return Response.json(body, { status });
}

export async function POST(request: NextRequest): Promise<Response> {
  // Auth via shared secret (constant-time compare).
  const provided = request.headers.get('X-Internal-Cron-Secret');
  if (!constantTimeEqual(provided, env.INTERNAL_CRON_SECRET)) {
    logger.warn({ hasHeader: Boolean(provided) }, 'weekly-summary: secret invalido');
    return errorResponse(401, {
      code: 'UNAUTHORIZED',
      message: 'X-Internal-Cron-Secret invalido o ausente',
    });
  }

  const admin = createServiceRoleClient();
  const now = new Date();
  const periodoIso = isoWeekId(now);
  const nowIso = now.toISOString();
  const desdeIso = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const hastaIso = new Date(now.getTime() + 7 * DAY_MS).toISOString();

  const consultoras = await resolverConsultorasConActividad(admin, desdeIso, nowIso, hastaIso);

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  const errors: { consultoraId: string; reason: string }[] = [];

  for (const c of consultoras) {
    try {
      const resumen = await armarResumenEpp(admin, c.id, desdeIso, nowIso, hastaIso);
      // Predicado "no email vacio": skip silencioso si no hay nada accionable.
      if (!resumenEsAccionable(resumen)) continue;
      processed += 1;
      const r = await sendEppWeeklySummary(admin, c, resumen, periodoIso);
      if (r.sent) sent += 1;
      else if (r.reason === 'already_sent') skipped += 1;
      else errors.push({ consultoraId: c.id, reason: r.reason });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error({ consultoraId: c.id, periodoIso, reason }, 'weekly-summary: consultora failed');
      errors.push({ consultoraId: c.id, reason });
    }
  }

  logger.info(
    { periodoIso, processed, sent, skipped, errors: errors.length },
    'weekly-summary: completed',
  );
  return Response.json({ ok: true, periodoIso, processed, sent, skipped, errors }, { status: 200 });
}
