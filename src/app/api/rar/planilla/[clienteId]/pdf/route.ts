import type { Json } from '@/shared/supabase/types';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getClienteById } from '@/app/(app)/clientes/queries';
import { listExpuestosByCliente } from '@/app/(app)/rar/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireBillingAccess } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { resolveInternalBaseUrl } from '@/shared/lib/resolve-internal-base-url';
import { logger } from '@/shared/observability/logger';
import { getInternalPdfRenderToken } from '@/shared/pdf/browser-pool';
import { buildRarPlanillaFilename } from '@/shared/pdf/filename';
import { injectBaseHref } from '@/shared/pdf/inject-base-href';
import { htmlToPdf, PdfRenderTimeoutError } from '@/shared/pdf/render';
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
 *  3.5 Trial gate: requireBillingAccess (operación costosa, gate pre-Puppeteer).
 *  4. Cargar cliente via RLS. Null → 404.
 *  4.5 Cross-tenant defense: consultora_id mismatch → 404 (RLS ya filtra).
 *  5. Cargar nómina de expuestos (puede estar vacía → PDF "sin personal expuesto").
 *  6. Internal fetch al print page con header `x-internal-pdf-render`.
 *  7. htmlToPdf con timeout interno + AbortController hard cap 20s.
 *  8. Audit log via service-role (non-blocking).
 *  9. Response 200 con Content-Type application/pdf + Content-Disposition
 *     attachment + filename `planilla-rar-<razon-social>-<fecha>.pdf`.
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

  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    logger.info(
      { userId: user.id, consultoraId: consultora.id, clienteId, reason: billing.reason },
      'rar_planilla_pdf_route: billing gated',
    );
    return Response.json(
      { code: 'BILLING_GATED', reason: billing.reason, message: getGateMessage(billing.reason) },
      { status: 402 },
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

  const baseUrl = resolveInternalBaseUrl(request);
  const cookieHeader = request.headers.get('cookie') ?? '';
  const printUrl = `${baseUrl}/rar/planilla/${clienteId}/print`;

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
          clienteId,
          userId: user.id,
          consultoraId: consultora.id,
          status: printRes.status,
        },
        'rar_planilla_pdf_route: print page fetch fallo',
      );
      clearTimeout(hardCap);
      return errorResponse(500, 'INTERNAL_ERROR', 'No se pudo renderear la planilla.');
    }
    html = await printRes.text();
  } catch (err) {
    clearTimeout(hardCap);
    if (ac.signal.aborted) {
      logger.warn(
        { clienteId, userId: user.id, consultoraId: consultora.id },
        'rar_planilla_pdf_route: hard cap timeout en internal fetch',
      );
      return errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.');
    }
    logger.error(
      { err: String(err), clienteId, userId: user.id, consultoraId: consultora.id },
      'rar_planilla_pdf_route: internal fetch fallo',
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
        { clienteId, userId: user.id, consultoraId: consultora.id, stage: err.message },
        'rar_planilla_pdf_route: render timeout',
      );
      return errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.');
    }
    logger.error(
      { err: String(err), clienteId, userId: user.id, consultoraId: consultora.id },
      'rar_planilla_pdf_route: htmlToPdf fallo',
    );
    return errorResponse(500, 'INTERNAL_ERROR', 'Hubo un error generando el PDF.');
  }
  clearTimeout(hardCap);

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
