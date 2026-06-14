import type { Json } from '@/shared/supabase/types';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getPresentacionById } from '@/app/(app)/rar/queries';
import { parseRarSnapshot } from '@/app/(app)/rar/snapshot';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireBillingAccess } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { resolveInternalBaseUrl } from '@/shared/lib/resolve-internal-base-url';
import { logger } from '@/shared/observability/logger';
import { getInternalPdfRenderToken } from '@/shared/pdf/browser-pool';
import { buildRarPlanillaHistoricaFilename } from '@/shared/pdf/filename';
import { injectBaseHref } from '@/shared/pdf/inject-base-href';
import { htmlToPdf, PdfRenderTimeoutError } from '@/shared/pdf/render';
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
 * mapping) está duplicado a propósito respecto al route de Fase 2: el DRY de los
 * routes PDF queda como FU de DEVEX transversal (no se hace acá).
 *
 * Flow:
 *  1. Validar `presentacionId` UUID.
 *  2. Auth: getUser. Null → 401.
 *  3. Consultora: getCurrentConsultora. Null → 403.
 *  3.5 Trial gate: requireBillingAccess (operación Puppeteer costosa).
 *  4. Cargar presentación via RLS. Null → 404.
 *  4.5 Cross-tenant defense: consultora_id mismatch → 404.
 *  5. Internal fetch al print page histórico con header `x-internal-pdf-render`.
 *  6. htmlToPdf con timeout interno + AbortController hard cap 20s.
 *  7. Audit log via service-role (non-blocking).
 *  8. Response 200 con filename `planilla-rar-<razon-social>-<periodo>.pdf`.
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

  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    logger.info(
      { userId: user.id, consultoraId: consultora.id, presentacionId, reason: billing.reason },
      'rar_historica_pdf_route: billing gated',
    );
    return Response.json(
      { code: 'BILLING_GATED', reason: billing.reason, message: getGateMessage(billing.reason) },
      { status: 402 },
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

  const baseUrl = resolveInternalBaseUrl(request);
  const cookieHeader = request.headers.get('cookie') ?? '';
  const printUrl = `${baseUrl}/rar/presentaciones/${presentacionId}/print`;

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
          presentacionId,
          userId: user.id,
          consultoraId: consultora.id,
          status: printRes.status,
        },
        'rar_historica_pdf_route: print page fetch fallo',
      );
      clearTimeout(hardCap);
      return errorResponse(500, 'INTERNAL_ERROR', 'No se pudo renderear la planilla.');
    }
    html = await printRes.text();
  } catch (err) {
    clearTimeout(hardCap);
    if (ac.signal.aborted) {
      logger.warn(
        { presentacionId, userId: user.id, consultoraId: consultora.id },
        'rar_historica_pdf_route: hard cap timeout en internal fetch',
      );
      return errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.');
    }
    logger.error(
      { err: String(err), presentacionId, userId: user.id, consultoraId: consultora.id },
      'rar_historica_pdf_route: internal fetch fallo',
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
        { presentacionId, userId: user.id, consultoraId: consultora.id, stage: err.message },
        'rar_historica_pdf_route: render timeout',
      );
      return errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.');
    }
    logger.error(
      { err: String(err), presentacionId, userId: user.id, consultoraId: consultora.id },
      'rar_historica_pdf_route: htmlToPdf fallo',
    );
    return errorResponse(500, 'INTERNAL_ERROR', 'Hubo un error generando el PDF.');
  }
  clearTimeout(hardCap);

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
