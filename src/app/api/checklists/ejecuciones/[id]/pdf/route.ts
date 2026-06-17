import type { Json } from '@/shared/supabase/types';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { billingAccessForRoute } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { logger } from '@/shared/observability/logger';
import { buildChecklistInspeccionFilename } from '@/shared/pdf/filename';
import { pdfDownloadResponse, renderPrintPageToPdf } from '@/shared/pdf/render-print-page';
import { getValidatedClientIp } from '@/shared/security/identify';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-060b · GET /api/checklists/ejecuciones/[id]/pdf
 *
 * Genera el PDF del Relevamiento RGRL (Res SRT 463/09) on-demand para una
 * inspección CERRADA. Permisos: cualquier member de la consultora (mismo gate
 * que SELECT). Mismo pipeline que EPP T-104 / informes T-023.
 *
 * El PDF NO se persiste (decisión RFC T-060): se renderiza on-demand → el cierre
 * no depende de Puppeteer. La integridad de los datos está cubierta por
 * `firma_pdf_hash` (sha256 del snapshot, calculado al cerrar).
 *
 * Flow: validar id → auth → consultora → billing gate (pre-Puppeteer) → cargar
 * ejecución (RLS + cross-tenant) → exigir estado='cerrada' (borrador → 422) →
 * fetch interno al print page con `x-internal-pdf-render` → htmlToPdf con hard
 * cap 20s → audit `after()` → 200 application/pdf + Content-Disposition.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const t0 = Date.now();
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    return errorResponse(400, 'INVALID_INPUT', 'ID de inspección inválido.');
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
    executionId: id,
  });
  if (!billing.ok) {
    if (billing.kind === 'gated') {
      logger.info(
        { userId: user.id, consultoraId: consultora.id, executionId: id, reason: billing.reason },
        'checklist_pdf_route: billing gated',
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

  const { data: exec } = await supabase
    .from('checklist_executions')
    .select('id, estado, consultora_id, establecimiento_razon_social, cerrada_at')
    .eq('id', id)
    .maybeSingle();
  if (!exec) {
    return errorResponse(404, 'NOT_FOUND', 'Inspección no encontrada.');
  }

  // Defense in depth contra RLS bypass (RLS ya filtra cross-tenant).
  if (exec.consultora_id !== consultora.id) {
    logger.warn(
      { executionId: id, userId: user.id, expected: consultora.id, got: exec.consultora_id },
      'checklist_pdf_route: cross-tenant access blocked',
    );
    return errorResponse(404, 'NOT_FOUND', 'Inspección no encontrada.');
  }

  if (exec.estado !== 'cerrada' || !exec.cerrada_at) {
    return errorResponse(
      422,
      'NOT_CLOSED',
      'La inspección todavía no está cerrada. No se puede generar el PDF.',
    );
  }

  // Internal fetch al print page + HTML → PDF via el pipeline compartido (T-148).
  const rendered = await renderPrintPageToPdf({
    request,
    printPath: `/checklists/ejecuciones/${id}/print`,
    recurso: 'la inspección',
    logPrefix: 'checklist_pdf_route',
    logBase: { executionId: id, userId: user.id, consultoraId: consultora.id },
  });
  if (!rendered.ok) return rendered.response;
  const pdfBuffer = rendered.pdf;

  const generationMs = Date.now() - t0;
  const filename = buildChecklistInspeccionFilename({
    establecimiento: exec.establecimiento_razon_social,
    cerradaAt: exec.cerrada_at,
  });

  const ip = getValidatedClientIp(request);
  const userAgent = request.headers.get('user-agent');
  const pdfSizeBytes = pdfBuffer.length;
  after(async () => {
    await writeAuditLog({
      consultoraId: consultora.id,
      userId: user.id,
      executionId: id,
      pdfSizeBytes,
      generationMs,
      ip,
      userAgent,
    });
  });

  logger.info(
    {
      executionId: id,
      userId: user.id,
      consultoraId: consultora.id,
      ms: generationMs,
      bytes: pdfSizeBytes,
    },
    'checklist_inspeccion_pdf_exported',
  );

  return pdfDownloadResponse({ pdf: pdfBuffer, filename });
}

type AuditLogArgs = {
  consultoraId: string;
  userId: string;
  executionId: string;
  pdfSizeBytes: number;
  generationMs: number;
  ip: string | null;
  userAgent: string | null;
};

async function writeAuditLog(args: AuditLogArgs): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const afterData: Json = {
      pdf_size_bytes: args.pdfSizeBytes,
      generation_ms: args.generationMs,
    };
    const { error } = await admin.from('audit_log').insert({
      consultora_id: args.consultoraId,
      actor_user_id: args.userId,
      action: 'checklist_inspeccion_exported_pdf',
      entity_type: 'checklist_executions',
      entity_id: args.executionId,
      after_data: afterData,
      user_agent: args.userAgent,
      ip: args.ip ?? null,
    });
    if (error) {
      logger.error(
        { err: error, executionId: args.executionId, consultoraId: args.consultoraId },
        'checklist_pdf_route: audit_log insert fallo (non-blocking)',
      );
    }
  } catch (err) {
    logger.error(
      { err: String(err), executionId: args.executionId, consultoraId: args.consultoraId },
      'checklist_pdf_route: audit_log unexpected error (non-blocking)',
    );
  }
}
