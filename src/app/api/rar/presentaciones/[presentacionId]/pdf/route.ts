import type { Json } from '@/shared/supabase/types';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getPresentacionById } from '@/app/(app)/rar/queries';
import { parseRarSnapshot } from '@/app/(app)/rar/snapshot';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { billingAccessForRoute } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { logger } from '@/shared/observability/logger';
import { buildRarPlanillaHistoricaFilename } from '@/shared/pdf/filename';
import { pdfDownloadResponse, renderPrintPageToPdf } from '@/shared/pdf/render-print-page';
import { getValidatedClientIp } from '@/shared/security/identify';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-147 · GET /api/rar/presentaciones/[presentacionId]/pdf
 *
 * Descarga histórica de la Planilla RAR desde el `snapshot` congelado de
 * `rar_presentaciones` — refleja lo efectivamente presentado, no la nómina viva.
 * Mismo pipeline que la planilla on-the-fly (T-144), apuntando al print page
 * histórico `/rar/presentaciones/[presentacionId]/print`.
 *
 * El pipeline (internal fetch + token + AbortController + htmlToPdf + error
 * mapping) vive en `renderPrintPageToPdf` (`@/shared/pdf/render-print-page`),
 * compartido por los 5 routes de PDF (T-148).
 *
 * Flow:
 *  1. Validar `presentacionId` UUID.
 *  2. Auth: getUser. Null → 401.
 *  3. Consultora: getCurrentConsultora. Null → 403.
 *  3.5 Trial gate: billingAccessForRoute (operación Puppeteer costosa).
 *  4. Cargar presentación via RLS. Null → 404.
 *  4.5 Cross-tenant defense: consultora_id mismatch → 404.
 *  5. Internal fetch al print page histórico con header `x-internal-pdf-render`.
 *  6. htmlToPdf con timeout interno + AbortController hard cap 20s.
 *  7. Audit log via service-role (non-blocking).
 *  8. Response 200 con filename `planilla-rar-<razon-social>-<periodo>.pdf`.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ErrorBody = { code: string; message: string };

function errorResponse(status: number, code: string, message: string): Response {
  const body: ErrorBody = { code, message };
  return Response.json(body, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ presentacionId: string }> },
): Promise<Response> {
  const t0 = Date.now();
  const { presentacionId } = await params;

  if (!UUID_REGEX.test(presentacionId)) {
    return errorResponse(400, 'INVALID_INPUT', 'ID de presentación inválido.');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Iniciá sesión.');
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return errorResponse(403, 'NO_CONSULTORA', 'Tu cuenta no tiene una consultora vinculada.');
  }

  const billing = await billingAccessForRoute(supabase, consultora, {
    userId: user.id,
    consultoraId: consultora.id,
    presentacionId,
  });
  if (!billing.ok) {
    if (billing.kind === 'gated') {
      logger.info(
        { userId: user.id, consultoraId: consultora.id, presentacionId, reason: billing.reason },
        'rar_historica_pdf_route: billing gated',
      );
      return Response.json(
        { code: 'BILLING_GATED', reason: billing.reason, message: getGateMessage(billing.reason) },
        { status: 402 },
      );
    }
    return errorResponse(
      503,
      'INTERNAL_ERROR',
      'No se pudo validar la suscripción. Reintentá en unos minutos.',
    );
  }

  const presentacion = await getPresentacionById(supabase, presentacionId);
  if (!presentacion) {
    return errorResponse(404, 'NOT_FOUND', 'Presentación no encontrada.');
  }

  // Defense in depth contra RLS bypass: RLS ya filtra cross-tenant, pero
  // verificamos explicit el consultora_id para que un cambio futuro al policy
  // no cause leak silencioso.
  if (presentacion.consultora_id !== consultora.id) {
    logger.warn(
      {
        presentacionId,
        userId: user.id,
        expected: consultora.id,
        got: presentacion.consultora_id,
      },
      'rar_historica_pdf_route: cross-tenant access blocked',
    );
    return errorResponse(404, 'NOT_FOUND', 'Presentación no encontrada.');
  }

  const parsed = parseRarSnapshot(presentacion.snapshot, presentacion.periodo);

  // Internal fetch al print page + HTML → PDF via el pipeline compartido (T-148).
  const rendered = await renderPrintPageToPdf({
    request,
    printPath: `/rar/presentaciones/${presentacionId}/print`,
    recurso: 'la planilla',
    logPrefix: 'rar_historica_pdf_route',
    logBase: { presentacionId, userId: user.id, consultoraId: consultora.id },
  });
  if (!rendered.ok) return rendered.response;
  const pdfBuffer = rendered.pdf;

  const generationMs = Date.now() - t0;
  const filename = buildRarPlanillaHistoricaFilename({
    razonSocial: parsed.cliente.razon_social,
    periodo: presentacion.periodo,
  });

  // `after()` garantiza que el INSERT corre DESPUES del response pero ANTES de
  // que el container termine. writeAuditLog tiene try/catch interno.
  const expuestosCount = parsed.nomina.expuestos.length;
  const agentesCount = parsed.nomina.agentes.length;
  const ip = getValidatedClientIp(request);
  const userAgent = request.headers.get('user-agent');
  after(async () => {
    await writeAuditLog({
      consultoraId: consultora.id,
      userId: user.id,
      presentacionId,
      periodo: presentacion.periodo,
      expuestosCount,
      agentesCount,
      pdfSizeBytes: pdfBuffer.length,
      generationMs,
      ip,
      userAgent,
    });
  });

  logger.info(
    {
      presentacionId,
      userId: user.id,
      consultoraId: consultora.id,
      periodo: presentacion.periodo,
      ms: generationMs,
      bytes: pdfBuffer.length,
      expuestosCount,
      agentesCount,
    },
    'rar_planilla_historica_pdf_exported',
  );

  return pdfDownloadResponse({ pdf: pdfBuffer, filename });
}

type AuditLogArgs = {
  consultoraId: string;
  userId: string;
  presentacionId: string;
  periodo: number;
  expuestosCount: number;
  agentesCount: number;
  pdfSizeBytes: number;
  generationMs: number;
  ip: string | null;
  userAgent: string | null;
};

async function writeAuditLog(args: AuditLogArgs): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const afterData: Json = {
      periodo: args.periodo,
      expuestos_count: args.expuestosCount,
      agentes_count: args.agentesCount,
      pdf_size_bytes: args.pdfSizeBytes,
      generation_ms: args.generationMs,
    };
    const { error } = await admin.from('audit_log').insert({
      consultora_id: args.consultoraId,
      actor_user_id: args.userId,
      action: 'rar_planilla_historica_exported_pdf',
      entity_type: 'rar_presentaciones',
      entity_id: args.presentacionId,
      after_data: afterData,
      user_agent: args.userAgent,
      ip: args.ip ?? null,
    });
    if (error) {
      logger.error(
        { err: error, presentacionId: args.presentacionId, consultoraId: args.consultoraId },
        'rar_historica_pdf_route: audit_log insert fallo (non-blocking)',
      );
    }
  } catch (err) {
    logger.error(
      { err: String(err), presentacionId: args.presentacionId, consultoraId: args.consultoraId },
      'rar_historica_pdf_route: audit_log unexpected error (non-blocking)',
    );
  }
}
