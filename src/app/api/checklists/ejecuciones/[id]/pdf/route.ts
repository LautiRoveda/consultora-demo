import type { Json } from '@/shared/supabase/types';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireBillingAccess } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { resolveInternalBaseUrl } from '@/shared/lib/resolve-internal-base-url';
import { logger } from '@/shared/observability/logger';
import { getInternalPdfRenderToken } from '@/shared/pdf/browser-pool';
import { buildChecklistInspeccionFilename } from '@/shared/pdf/filename';
import { injectBaseHref } from '@/shared/pdf/inject-base-href';
import { htmlToPdf, PdfRenderTimeoutError } from '@/shared/pdf/render';
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

const HARD_CAP_MS = 20_000;
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

  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    logger.info(
      { userId: user.id, consultoraId: consultora.id, executionId: id, reason: billing.reason },
      'checklist_pdf_route: billing gated',
    );
    return Response.json(
      { code: 'BILLING_GATED', reason: billing.reason, message: getGateMessage(billing.reason) },
      { status: 402 },
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

  const baseUrl = resolveInternalBaseUrl(request);
  const cookieHeader = request.headers.get('cookie') ?? '';
  const printUrl = `${baseUrl}/checklists/ejecuciones/${id}/print`;

  const ac = new AbortController();
  const hardCap = setTimeout(() => ac.abort(), HARD_CAP_MS);

  let html: string;
  try {
    const printRes = await fetch(printUrl, {
      method: 'GET',
      headers: { cookie: cookieHeader, 'x-internal-pdf-render': getInternalPdfRenderToken() },
      signal: ac.signal,
      cache: 'no-store',
    });
    if (!printRes.ok) {
      clearTimeout(hardCap);
      logger.error(
        { executionId: id, userId: user.id, consultoraId: consultora.id, status: printRes.status },
        'checklist_pdf_route: print page fetch fallo',
      );
      return errorResponse(500, 'INTERNAL_ERROR', 'No se pudo renderear la inspección.');
    }
    html = await printRes.text();
  } catch (err) {
    clearTimeout(hardCap);
    if (ac.signal.aborted) {
      logger.warn(
        { executionId: id, userId: user.id, consultoraId: consultora.id },
        'checklist_pdf_route: hard cap timeout en internal fetch',
      );
      return errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.');
    }
    logger.error(
      { err: String(err), executionId: id, userId: user.id, consultoraId: consultora.id },
      'checklist_pdf_route: internal fetch fallo',
    );
    return errorResponse(500, 'INTERNAL_ERROR', 'No se pudo renderear la inspección.');
  }

  const htmlWithBase = injectBaseHref(html, baseUrl);
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await htmlToPdf(htmlWithBase);
  } catch (err) {
    clearTimeout(hardCap);
    if (err instanceof PdfRenderTimeoutError) {
      logger.warn(
        { executionId: id, userId: user.id, consultoraId: consultora.id, stage: err.message },
        'checklist_pdf_route: render timeout',
      );
      return errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.');
    }
    logger.error(
      { err: String(err), executionId: id, userId: user.id, consultoraId: consultora.id },
      'checklist_pdf_route: htmlToPdf fallo',
    );
    return errorResponse(500, 'INTERNAL_ERROR', 'Hubo un error generando el PDF.');
  }
  clearTimeout(hardCap);

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
