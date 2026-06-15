import type { InformeTipo } from '@/app/(app)/informes/schema';
import type { Json } from '@/shared/supabase/types';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getInformeById } from '@/app/(app)/informes/queries';
import { INFORME_TIPOS } from '@/app/(app)/informes/schema';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireBillingAccess } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { logger } from '@/shared/observability/logger';
import { buildPdfFilename } from '@/shared/pdf/filename';
import { pdfDownloadResponse, renderPrintPageToPdf } from '@/shared/pdf/render-print-page';
import { getValidatedClientIp } from '@/shared/security/identify';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-023 · GET /api/informes/[id]/pdf
 *
 * Genera el PDF de un informe y lo devuelve como descarga. Permisos: cualquier
 * member de la consultora (mismo gate que SELECT de /informes/[id]) — exportar
 * es lectura.
 *
 * Flow:
 *  1. Validar `id` UUID.
 *  2. Auth: getUser. Null → 401.
 *  3. Consultora: getCurrentConsultora. Null → 403.
 *  4. Cargar informe via RLS. Null → 404 (cubre cross-tenant + id inexistente).
 *  5. Si contenido vacio → 422.
 *  6. Internal fetch a `/informes/[id]/print` con header `x-internal-pdf-render`.
 *  7. htmlToPdf con timeout interno + AbortController hard cap 20s.
 *  8. Audit log via service-role (audit_log INSERT default-deny para
 *     authenticated). Non-blocking: log fail no bloquea el response.
 *  9. Response 200 con Content-Type application/pdf + Content-Disposition
 *     attachment + filename.
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

  // 1. Path param shape.
  if (!UUID_REGEX.test(id)) {
    return errorResponse(400, 'INVALID_INPUT', 'ID de informe invalido.');
  }

  // 2. Auth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Iniciá sesión.');
  }

  // 3. Consultora.
  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return errorResponse(403, 'NO_CONSULTORA', 'Tu cuenta no tiene una consultora vinculada.');
  }

  // 3.5. T-073 · Trial gate. Pre-fetch del informe y pre-Puppeteer (operación
  // costosa). Status 402 Payment Required.
  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    logger.info(
      { userId: user.id, consultoraId: consultora.id, informeId: id, reason: billing.reason },
      'pdf_route: billing gated',
    );
    return Response.json(
      { code: 'BILLING_GATED', reason: billing.reason, message: getGateMessage(billing.reason) },
      { status: 402 },
    );
  }

  // 4. Cargar informe (RLS limita al tenant).
  const informe = await getInformeById(supabase, id);
  if (!informe) {
    return errorResponse(404, 'NOT_FOUND', 'Informe no encontrado.');
  }

  // Defensa: tipo dentro del set conocido. La DB lo garantiza via check
  // constraint pero TS no lo sabe.
  if (!(INFORME_TIPOS as readonly string[]).includes(informe.tipo)) {
    logger.error({ informeId: id, tipo: informe.tipo }, 'pdf_route: tipo desconocido');
    return errorResponse(500, 'INTERNAL_ERROR', 'Tipo de informe invalido.');
  }
  const tipo = informe.tipo as InformeTipo;

  // 5. Contenido obligatorio para exportar.
  if (!informe.contenido || informe.contenido.trim() === '') {
    return errorResponse(
      422,
      'EMPTY_CONTENT',
      'El informe no tiene contenido. Generá un borrador antes de descargar.',
    );
  }

  // 6-7. Internal fetch al print page + HTML → PDF via el pipeline compartido
  // (T-148). El helper hace fetch con token + AbortController hard cap 20s +
  // injectBaseHref + htmlToPdf, y mapea los errores a HTTP con estos logs.
  const rendered = await renderPrintPageToPdf({
    request,
    printPath: `/informes/${id}/print`,
    recurso: 'el informe',
    logPrefix: 'pdf_route',
    logBase: { informeId: id, userId: user.id, consultoraId: consultora.id },
  });
  if (!rendered.ok) return rendered.response;
  const pdfBuffer = rendered.pdf;

  const generationMs = Date.now() - t0;
  const filename = buildPdfFilename({
    tipo,
    titulo: informe.titulo,
    createdAt: informe.created_at,
  });

  // 8. Audit log via service-role (audit_log INSERT default-deny para
  // authenticated, solo service-role o triggers AFTER). Non-blocking: si el
  // INSERT falla, loggeamos pero NO bloqueamos el response — el user ya
  // pago el costo de generacion, perder el log es menos malo que perder el PDF.
  //
  // CHORE-D · I5: `after()` garantiza que el INSERT corre DESPUES del response
  // pero ANTES de que el container/instance termine. `void` por si solo no lo
  // garantiza — en serverless/container el proceso puede matar la operacion
  // si el response cierra antes que el INSERT resuelva. writeAuditLog tiene
  // try/catch interno (linea ~260), no propaga errores al response.
  //
  // Captura del contenido.length antes del closure: el narrowing de
  // `informe.contenido` del guard linea 108 no se preserva dentro del
  // async () =>, asi que resolvemos en consts fuera del closure.
  const titulo = informe.titulo;
  const contentSize = informe.contenido.length;
  const ip = getValidatedClientIp(request);
  const userAgent = request.headers.get('user-agent');
  after(async () => {
    await writeAuditLog({
      consultoraId: consultora.id,
      userId: user.id,
      informeId: id,
      titulo,
      tipo,
      pdfSizeBytes: pdfBuffer.length,
      contentSize,
      generationMs,
      ip,
      userAgent,
    });
  });

  logger.info(
    {
      informeId: id,
      userId: user.id,
      consultoraId: consultora.id,
      tipo,
      ms: generationMs,
      bytes: pdfBuffer.length,
      hasMetadata: informe.contenido.length > 0,
    },
    'informe_pdf_exported',
  );

  // 9. Response 200 con los headers de descarga (RFC 6266 filename + filename*).
  return pdfDownloadResponse({ pdf: pdfBuffer, filename });
}

type AuditLogArgs = {
  consultoraId: string;
  userId: string;
  informeId: string;
  titulo: string;
  tipo: InformeTipo;
  pdfSizeBytes: number;
  contentSize: number;
  generationMs: number;
  ip: string | null;
  userAgent: string | null;
};

async function writeAuditLog(args: AuditLogArgs): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const afterData: Json = {
      titulo: args.titulo,
      tipo: args.tipo,
      pdf_size_bytes: args.pdfSizeBytes,
      content_size: args.contentSize,
      generation_ms: args.generationMs,
    };
    const { error } = await admin.from('audit_log').insert({
      consultora_id: args.consultoraId,
      actor_user_id: args.userId,
      action: 'informe_exported_pdf',
      entity_type: 'informes',
      entity_id: args.informeId,
      after_data: afterData,
      user_agent: args.userAgent,
      // ip column es `inet`. La supabase types lo expone como `unknown` (postgres
      // no tiene tipo TS directo). Pasamos el string crudo — `null` si no vino.
      ip: args.ip ?? null,
    });
    if (error) {
      logger.error(
        { err: error, informeId: args.informeId, consultoraId: args.consultoraId },
        'pdf_route: audit_log insert fallo (non-blocking)',
      );
    }
  } catch (err) {
    logger.error(
      { err: String(err), informeId: args.informeId, consultoraId: args.consultoraId },
      'pdf_route: audit_log unexpected error (non-blocking)',
    );
  }
}
