import type { Json } from '@/shared/supabase/types';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getEntregaForPlanilla } from '@/app/(app)/epp/entregas/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { billingAccessForRoute } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { logger } from '@/shared/observability/logger';
import { buildEppPlanillaFilename } from '@/shared/pdf/filename';
import { pdfDownloadResponse, renderPrintPageToPdf } from '@/shared/pdf/render-print-page';
import { getValidatedClientIp } from '@/shared/security/identify';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-104 · GET /api/epp/entregas/[id]/pdf
 *
 * Genera la Planilla Res SRT 299/11 en PDF para una entrega EPP firmada.
 * Permisos: cualquier member de la consultora (mismo gate que SELECT de
 * /epp/entregas/[id]). Mismo pipeline que T-023 informes PDF.
 *
 * Flow:
 *  1. Validar `id` UUID.
 *  2. Auth: getUser. Null → 401.
 *  3. Consultora: getCurrentConsultora. Null → 403.
 *  3.5 Trial gate: billingAccessForRoute (operación costosa, gate pre-Puppeteer).
 *  4. Cargar entrega via RLS. Null → 404.
 *  4.5 Cross-tenant defense: consultora_id mismatch → 404 (RLS ya filtra).
 *  5. Firma obligatoria: firmado_at + firma_storage_path → 422 NOT_SIGNED.
 *  5.5 Items obligatorios: 0 items → 422 EMPTY_DELIVERY (defensive, schema lo cubre).
 *  6. Internal fetch al print page con header `x-internal-pdf-render`.
 *  7. htmlToPdf con timeout interno + AbortController hard cap 20s.
 *  8. Audit log via service-role (non-blocking).
 *  9. Response 200 con Content-Type application/pdf + Content-Disposition
 *     attachment + filename `planilla-299-11-<apellido>-<fecha>.pdf`.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ErrorBody = { code: string; message: string };

function errorResponse(status: number, code: string, message: string): Response {
  const body: ErrorBody = { code, message };
  return Response.json(body, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const t0 = Date.now();
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    return errorResponse(400, 'INVALID_INPUT', 'ID de entrega inválido.');
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
    entregaId: id,
  });
  if (!billing.ok) {
    if (billing.kind === 'gated') {
      logger.info(
        { userId: user.id, consultoraId: consultora.id, entregaId: id, reason: billing.reason },
        'epp_planilla_pdf_route: billing gated',
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

  const entrega = await getEntregaForPlanilla(supabase, id);
  if (!entrega) {
    return errorResponse(404, 'NOT_FOUND', 'Entrega no encontrada.');
  }

  // Defense in depth contra RLS bypass: RLS ya filtra cross-tenant, pero
  // verificamos explicit el consultora_id para que un cambio futuro al policy
  // no cause leak silencioso.
  if (entrega.consultora_id !== consultora.id) {
    logger.warn(
      {
        entregaId: id,
        userId: user.id,
        expected: consultora.id,
        got: entrega.consultora_id,
      },
      'epp_planilla_pdf_route: cross-tenant access blocked',
    );
    return errorResponse(404, 'NOT_FOUND', 'Entrega no encontrada.');
  }

  if (!entrega.firmado_at || !entrega.firma_storage_path) {
    return errorResponse(
      422,
      'NOT_SIGNED',
      'La entrega no fue firmada todavía. No se puede generar la planilla.',
    );
  }

  if (entrega.items.length === 0) {
    return errorResponse(422, 'EMPTY_DELIVERY', 'La entrega no tiene ítems registrados.');
  }

  if (!entrega.empleado) {
    logger.error(
      { entregaId: id, consultoraId: consultora.id },
      'epp_planilla_pdf_route: entrega sin empleado (FK rota)',
    );
    return errorResponse(500, 'INTERNAL_ERROR', 'La entrega tiene datos inconsistentes.');
  }

  // Internal fetch al print page + HTML → PDF via el pipeline compartido (T-148).
  const rendered = await renderPrintPageToPdf({
    request,
    printPath: `/epp/entregas/${id}/print`,
    recurso: 'la planilla',
    logPrefix: 'epp_planilla_pdf_route',
    logBase: { entregaId: id, userId: user.id, consultoraId: consultora.id },
  });
  if (!rendered.ok) return rendered.response;
  const pdfBuffer = rendered.pdf;

  const generationMs = Date.now() - t0;
  const filename = buildEppPlanillaFilename({
    apellido: entrega.empleado.apellido,
    fechaEntrega: entrega.fecha_entrega,
  });

  // CHORE-D · I5: `after()` garantiza que el INSERT corre DESPUES del response
  // pero ANTES de que el container/instance termine. `void` por si solo no lo
  // garantiza — en serverless/container el proceso puede matar la operacion
  // si el response cierra antes que el INSERT resuelva. writeAuditLog tiene
  // try/catch interno (linea ~255), no propaga errores al response.
  //
  // Captura del apellido antes del closure: el narrowing de `entrega.empleado`
  // del guard linea 121 no se preserva dentro del async () =>, asi que lo
  // resolvemos en una const fuera del closure.
  const empleadoApellido = entrega.empleado.apellido;
  const itemsCount = entrega.items.length;
  const ip = getValidatedClientIp(request);
  const userAgent = request.headers.get('user-agent');
  after(async () => {
    await writeAuditLog({
      consultoraId: consultora.id,
      userId: user.id,
      entregaId: id,
      empleadoApellido,
      itemsCount,
      pdfSizeBytes: pdfBuffer.length,
      generationMs,
      ip,
      userAgent,
    });
  });

  logger.info(
    {
      entregaId: id,
      userId: user.id,
      consultoraId: consultora.id,
      ms: generationMs,
      bytes: pdfBuffer.length,
      itemsCount: entrega.items.length,
    },
    'epp_planilla_pdf_exported',
  );

  return pdfDownloadResponse({ pdf: pdfBuffer, filename });
}

type AuditLogArgs = {
  consultoraId: string;
  userId: string;
  entregaId: string;
  empleadoApellido: string;
  itemsCount: number;
  pdfSizeBytes: number;
  generationMs: number;
  ip: string | null;
  userAgent: string | null;
};

async function writeAuditLog(args: AuditLogArgs): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const afterData: Json = {
      empleado_apellido: args.empleadoApellido,
      items_count: args.itemsCount,
      pdf_size_bytes: args.pdfSizeBytes,
      generation_ms: args.generationMs,
    };
    const { error } = await admin.from('audit_log').insert({
      consultora_id: args.consultoraId,
      actor_user_id: args.userId,
      action: 'epp_entrega_planilla_exported_pdf',
      entity_type: 'epp_entregas',
      entity_id: args.entregaId,
      after_data: afterData,
      user_agent: args.userAgent,
      ip: args.ip ?? null,
    });
    if (error) {
      logger.error(
        { err: error, entregaId: args.entregaId, consultoraId: args.consultoraId },
        'epp_planilla_pdf_route: audit_log insert fallo (non-blocking)',
      );
    }
  } catch (err) {
    logger.error(
      { err: String(err), entregaId: args.entregaId, consultoraId: args.consultoraId },
      'epp_planilla_pdf_route: audit_log unexpected error (non-blocking)',
    );
  }
}
