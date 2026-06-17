import type { Json } from '@/shared/supabase/types';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getClienteById } from '@/app/(app)/clientes/queries';
import { listExpuestosByCliente } from '@/app/(app)/rar/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { billingAccessForRoute } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { logger } from '@/shared/observability/logger';
import { buildRarPlanillaFilename } from '@/shared/pdf/filename';
import { pdfDownloadResponse, renderPrintPageToPdf } from '@/shared/pdf/render-print-page';
import { getValidatedClientIp } from '@/shared/security/identify';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-144 · GET /api/rar/planilla/[clienteId]/pdf
 *
 * Genera la Planilla RAR (Res SRT 37/2010 + Dto 658/96) en PDF para un
 * cliente/establecimiento, on-the-fly desde la nómina viva (sin snapshot —
 * eso llega en Fase 3 con `rar_presentaciones`). Mismo pipeline que la planilla
 * EPP (T-104).
 *
 * Flow:
 *  1. Validar `clienteId` UUID.
 *  2. Auth: getUser. Null → 401.
 *  3. Consultora: getCurrentConsultora. Null → 403.
 *  3.5 Trial gate: billingAccessForRoute (operación costosa, gate pre-Puppeteer).
 *  4. Cargar cliente via RLS. Null → 404.
 *  4.5 Cross-tenant defense: consultora_id mismatch → 404 (RLS ya filtra).
 *  5. Cargar nómina de expuestos (puede estar vacía → PDF "sin personal expuesto").
 *  6. Internal fetch al print page con header `x-internal-pdf-render`.
 *  7. htmlToPdf con timeout interno + AbortController hard cap 20s.
 *  8. Audit log via service-role (non-blocking).
 *  9. Response 200 con Content-Type application/pdf + Content-Disposition
 *     attachment + filename `planilla-rar-<razon-social>-<fecha>.pdf`.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ErrorBody = { code: string; message: string };

function errorResponse(status: number, code: string, message: string): Response {
  const body: ErrorBody = { code, message };
  return Response.json(body, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clienteId: string }> },
): Promise<Response> {
  const t0 = Date.now();
  const { clienteId } = await params;

  if (!UUID_REGEX.test(clienteId)) {
    return errorResponse(400, 'INVALID_INPUT', 'ID de cliente inválido.');
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
    clienteId,
  });
  if (!billing.ok) {
    if (billing.kind === 'gated') {
      logger.info(
        { userId: user.id, consultoraId: consultora.id, clienteId, reason: billing.reason },
        'rar_planilla_pdf_route: billing gated',
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

  const cliente = await getClienteById(supabase, clienteId);
  if (!cliente) {
    return errorResponse(404, 'NOT_FOUND', 'Cliente no encontrado.');
  }

  // Defense in depth contra RLS bypass: RLS ya filtra cross-tenant, pero
  // verificamos explicit el consultora_id para que un cambio futuro al policy
  // no cause leak silencioso.
  if (cliente.consultora_id !== consultora.id) {
    logger.warn(
      {
        clienteId,
        userId: user.id,
        expected: consultora.id,
        got: cliente.consultora_id,
      },
      'rar_planilla_pdf_route: cross-tenant access blocked',
    );
    return errorResponse(404, 'NOT_FOUND', 'Cliente no encontrado.');
  }

  // La nómina vacía NO es un error: el PDF se genera igual declarando "sin
  // personal expuesto" (T-144 D5). Solo la usamos para el audit log.
  const nomina = await listExpuestosByCliente(supabase, clienteId);

  // Internal fetch al print page + HTML → PDF via el pipeline compartido (T-148).
  const rendered = await renderPrintPageToPdf({
    request,
    printPath: `/rar/planilla/${clienteId}/print`,
    recurso: 'la planilla',
    logPrefix: 'rar_planilla_pdf_route',
    logBase: { clienteId, userId: user.id, consultoraId: consultora.id },
  });
  if (!rendered.ok) return rendered.response;
  const pdfBuffer = rendered.pdf;

  const generationMs = Date.now() - t0;
  const filename = buildRarPlanillaFilename({
    razonSocial: cliente.razon_social,
    generatedAt: new Date(),
  });

  // CHORE-D · I5: `after()` garantiza que el INSERT corre DESPUES del response
  // pero ANTES de que el container termine. writeAuditLog tiene try/catch
  // interno, no propaga errores al response.
  const expuestosCount = nomina.expuestos.length;
  const agentesCount = nomina.agentes.length;
  const ip = getValidatedClientIp(request);
  const userAgent = request.headers.get('user-agent');
  after(async () => {
    await writeAuditLog({
      consultoraId: consultora.id,
      userId: user.id,
      clienteId,
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
      clienteId,
      userId: user.id,
      consultoraId: consultora.id,
      ms: generationMs,
      bytes: pdfBuffer.length,
      expuestosCount,
      agentesCount,
    },
    'rar_planilla_pdf_exported',
  );

  return pdfDownloadResponse({ pdf: pdfBuffer, filename });
}

type AuditLogArgs = {
  consultoraId: string;
  userId: string;
  clienteId: string;
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
      expuestos_count: args.expuestosCount,
      agentes_count: args.agentesCount,
      pdf_size_bytes: args.pdfSizeBytes,
      generation_ms: args.generationMs,
    };
    const { error } = await admin.from('audit_log').insert({
      consultora_id: args.consultoraId,
      actor_user_id: args.userId,
      action: 'rar_planilla_exported_pdf',
      entity_type: 'clientes',
      entity_id: args.clienteId,
      after_data: afterData,
      user_agent: args.userAgent,
      ip: args.ip ?? null,
    });
    if (error) {
      logger.error(
        { err: error, clienteId: args.clienteId, consultoraId: args.consultoraId },
        'rar_planilla_pdf_route: audit_log insert fallo (non-blocking)',
      );
    }
  } catch (err) {
    logger.error(
      { err: String(err), clienteId: args.clienteId, consultoraId: args.consultoraId },
      'rar_planilla_pdf_route: audit_log unexpected error (non-blocking)',
    );
  }
}
