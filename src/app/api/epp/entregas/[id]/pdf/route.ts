import type { Json } from '@/shared/supabase/types';
import { type NextRequest } from 'next/server';

import { getEntregaForPlanilla } from '@/app/(app)/epp/entregas/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireBillingAccess } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { resolveInternalBaseUrl } from '@/shared/lib/resolve-internal-base-url';
import { logger } from '@/shared/observability/logger';
import { getInternalPdfRenderToken } from '@/shared/pdf/browser-pool';
import { buildEppPlanillaFilename } from '@/shared/pdf/filename';
import { injectBaseHref } from '@/shared/pdf/inject-base-href';
import { htmlToPdf, PdfRenderTimeoutError } from '@/shared/pdf/render';
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
 *  3.5 Trial gate: requireBillingAccess (operación costosa, gate pre-Puppeteer).
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

const HARD_CAP_MS = 20_000;
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

  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    logger.info(
      { userId: user.id, consultoraId: consultora.id, entregaId: id, reason: billing.reason },
      'epp_planilla_pdf_route: billing gated',
    );
    return Response.json(
      { code: 'BILLING_GATED', reason: billing.reason, message: getGateMessage(billing.reason) },
      { status: 402 },
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

  const baseUrl = resolveInternalBaseUrl(request);
  const cookieHeader = request.headers.get('cookie') ?? '';
  const printUrl = `${baseUrl}/epp/entregas/${id}/print`;

  const ac = new AbortController();
  const hardCap = setTimeout(() => ac.abort(), HARD_CAP_MS);

  let html: string;
  try {
    const printRes = await fetch(printUrl, {
      method: 'GET',
      headers: {
        cookie: cookieHeader,
        'x-internal-pdf-render': getInternalPdfRenderToken(),
      },
      signal: ac.signal,
      cache: 'no-store',
    });
    if (!printRes.ok) {
      logger.error(
        {
          entregaId: id,
          userId: user.id,
          consultoraId: consultora.id,
          status: printRes.status,
        },
        'epp_planilla_pdf_route: print page fetch fallo',
      );
      clearTimeout(hardCap);
      return errorResponse(500, 'INTERNAL_ERROR', 'No se pudo renderear la planilla.');
    }
    html = await printRes.text();
  } catch (err) {
    clearTimeout(hardCap);
    if (ac.signal.aborted) {
      logger.warn(
        { entregaId: id, userId: user.id, consultoraId: consultora.id },
        'epp_planilla_pdf_route: hard cap timeout en internal fetch',
      );
      return errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.');
    }
    logger.error(
      { err: String(err), entregaId: id, userId: user.id, consultoraId: consultora.id },
      'epp_planilla_pdf_route: internal fetch fallo',
    );
    return errorResponse(500, 'INTERNAL_ERROR', 'No se pudo renderear la planilla.');
  }

  const htmlWithBase = injectBaseHref(html, baseUrl);
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await htmlToPdf(htmlWithBase);
  } catch (err) {
    clearTimeout(hardCap);
    if (err instanceof PdfRenderTimeoutError) {
      logger.warn(
        { entregaId: id, userId: user.id, consultoraId: consultora.id, stage: err.message },
        'epp_planilla_pdf_route: render timeout',
      );
      return errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.');
    }
    logger.error(
      { err: String(err), entregaId: id, userId: user.id, consultoraId: consultora.id },
      'epp_planilla_pdf_route: htmlToPdf fallo',
    );
    return errorResponse(500, 'INTERNAL_ERROR', 'Hubo un error generando el PDF.');
  }
  clearTimeout(hardCap);

  const generationMs = Date.now() - t0;
  const filename = buildEppPlanillaFilename({
    apellido: entrega.empleado.apellido,
    fechaEntrega: entrega.fecha_entrega,
  });

  void writeAuditLog({
    consultoraId: consultora.id,
    userId: user.id,
    entregaId: id,
    empleadoApellido: entrega.empleado.apellido,
    itemsCount: entrega.items.length,
    pdfSizeBytes: pdfBuffer.length,
    generationMs,
    // C8 audit · IP validada antes de INSERT (audit_log.ip es `inet`).
    ip: getValidatedClientIp(request),
    userAgent: request.headers.get('user-agent'),
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

  const asciiFilename = filename.replace(/[^\x20-\x7e]/g, '_');
  const utf8Filename = encodeURIComponent(filename);
  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdfBuffer.length),
      'Content-Disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${utf8Filename}`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
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
