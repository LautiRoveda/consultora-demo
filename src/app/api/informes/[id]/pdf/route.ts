import type { InformeTipo } from '@/app/(app)/informes/schema';
import type { Json } from '@/shared/supabase/types';
import { type NextRequest } from 'next/server';

import { getInformeById } from '@/app/(app)/informes/queries';
import { INFORME_TIPOS } from '@/app/(app)/informes/schema';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { resolveInternalBaseUrl } from '@/shared/lib/resolve-internal-base-url';
import { logger } from '@/shared/observability/logger';
import { getInternalPdfRenderToken } from '@/shared/pdf/browser-pool';
import { buildPdfFilename } from '@/shared/pdf/filename';
import { injectBaseHref } from '@/shared/pdf/inject-base-href';
import { htmlToPdf, PdfRenderTimeoutError } from '@/shared/pdf/render';
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

  // 6. Internal fetch al print page. Pasamos las cookies del request original
  // para que el `createClient()` de adentro vea la sesion. El token defiende
  // contra acceso directo desde browser.
  const baseUrl = resolveInternalBaseUrl(request);
  const cookieHeader = request.headers.get('cookie') ?? '';
  const printUrl = `${baseUrl}/informes/${id}/print`;

  // AbortController como hard cap. Si los timeouts internos de htmlToPdf
  // (setContent 10s + page.pdf 15s) fallan en disparar, este lo aborta a 20s.
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
      // Bypass de cualquier cache (no deberia haber, pero defensivo).
      cache: 'no-store',
    });
    if (!printRes.ok) {
      logger.error(
        {
          informeId: id,
          userId: user.id,
          consultoraId: consultora.id,
          status: printRes.status,
        },
        'pdf_route: print page fetch fallo',
      );
      clearTimeout(hardCap);
      return errorResponse(500, 'INTERNAL_ERROR', 'No se pudo renderear el informe.');
    }
    html = await printRes.text();
  } catch (err) {
    clearTimeout(hardCap);
    if (ac.signal.aborted) {
      logger.warn(
        { informeId: id, userId: user.id, consultoraId: consultora.id },
        'pdf_route: hard cap timeout en internal fetch',
      );
      return errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.');
    }
    logger.error(
      { err: String(err), informeId: id, userId: user.id, consultoraId: consultora.id },
      'pdf_route: internal fetch fallo',
    );
    return errorResponse(500, 'INTERNAL_ERROR', 'No se pudo renderear el informe.');
  }

  // 7. HTML → PDF. Inyectamos `<base href>` antes de pasar a Puppeteer porque
  // `setContent` renderea en about:blank y las URLs relativas del CSS de
  // Tailwind no resuelven sin base. Reusamos el `baseUrl` ya computed arriba.
  const htmlWithBase = injectBaseHref(html, baseUrl);
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await htmlToPdf(htmlWithBase);
  } catch (err) {
    clearTimeout(hardCap);
    if (err instanceof PdfRenderTimeoutError) {
      logger.warn(
        { informeId: id, userId: user.id, consultoraId: consultora.id, stage: err.message },
        'pdf_route: render timeout',
      );
      return errorResponse(504, 'RENDER_TIMEOUT', 'El PDF tardó demasiado. Reintentá.');
    }
    logger.error(
      { err: String(err), informeId: id, userId: user.id, consultoraId: consultora.id },
      'pdf_route: htmlToPdf fallo',
    );
    return errorResponse(500, 'INTERNAL_ERROR', 'Hubo un error generando el PDF.');
  }
  clearTimeout(hardCap);

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
  void writeAuditLog({
    consultoraId: consultora.id,
    userId: user.id,
    informeId: id,
    titulo: informe.titulo,
    tipo,
    pdfSizeBytes: pdfBuffer.length,
    contentSize: informe.contenido.length,
    generationMs,
    ip: request.headers.get('x-forwarded-for'),
    userAgent: request.headers.get('user-agent'),
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

  // 9. Response. RFC 6266 filename + filename* para UTF-8 (acentos en titulo).
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
