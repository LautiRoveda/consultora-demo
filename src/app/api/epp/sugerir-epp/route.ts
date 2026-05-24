import { type NextRequest } from 'next/server';

import { suggestEppForEmpleado } from '@/shared/ai/epp-suggest';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireBillingAccess } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { logger } from '@/shared/observability/logger';
import { getRateLimiter } from '@/shared/security/rate-limit';
import { createClient } from '@/shared/supabase/server';

import { sugerirEppBodySchema } from './schema';

/**
 * T-106 · POST /api/epp/sugerir-epp
 *
 * Recibe `{ empleado_id }`, valida auth + tenant + billing + rate limit, y
 * llama Claude Haiku 4.5 con tool_use forzado para recomendar EPP del catálogo
 * en función de los puestos asignados al empleado.
 *
 * Responses:
 *  - 200 OK con `{ suggestions, puestos_considerados, ... }` (también caso
 *    `no_puestos` / `no_catalogo` con `suggestions: []` + `reason`).
 *  - 400 INVALID_INPUT (body mal formado).
 *  - 401 UNAUTHENTICATED (sin cookie).
 *  - 403 NO_CONSULTORA (auth ok pero sin membership).
 *  - 402 BILLING_GATED (trial vencido / suscripción).
 *  - 404 EMPLEADO_NOT_FOUND (RLS scope + soft delete).
 *  - 429 RATE_LIMITED.
 *  - 500 AI_PARSE_ERROR (Claude devolvió output que no matchea schema).
 *
 * Costo: ~$0.01 USD por request (Haiku 4.5 ~2K tokens típicos). Logueado en
 * structured log para tracking de gasto IA.
 */

// Rate limit por consultora (no por user). Razón: 10 req/min con 5 users del
// mismo tenant funciona bien — la sugerencia es por-empleado y el consultor
// la pide eventualmente, no en loop. user_id daría false-negatives en
// consultoras con team. window '1 m' clarifica costo techo $0.10/min por
// tenant.
const eppSuggestLimiter = getRateLimiter({
  identifier: 'epp-suggest-consultora',
  limit: 10,
  window: '1 m',
});

type ErrorBody = { code: string; message: string };

function errorResponse(status: number, code: string, message: string): Response {
  const body: ErrorBody = { code, message };
  return Response.json(body, { status });
}

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Body validation.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(400, 'INVALID_INPUT', 'Body inválido (no es JSON).');
  }
  const parsedBody = sugerirEppBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return errorResponse(
      400,
      'INVALID_INPUT',
      parsedBody.error.issues[0]?.message ?? 'Body inválido.',
    );
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

  // 4. Billing gate. Bloqueamos pre-IA para no quemar tokens si la consultora
  // no puede generar.
  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    logger.info(
      { userId: user.id, consultoraId: consultora.id, reason: billing.reason },
      'epp_suggest_billing_gated',
    );
    return Response.json(
      { code: 'BILLING_GATED', reason: billing.reason, message: getGateMessage(billing.reason) },
      { status: 402 },
    );
  }

  // 5. Rate limit por consultora.
  const rl = await eppSuggestLimiter.limit(consultora.id);
  if (!rl.success) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, code: 'RATE_LIMITED' },
      'epp_suggest_rate_limited',
    );
    return new Response(
      JSON.stringify({
        code: 'RATE_LIMITED',
        message: `Demasiadas sugerencias. Reintentá en ${rl.retryAfterSeconds}s.`,
        retryAfterSeconds: rl.retryAfterSeconds,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rl.retryAfterSeconds),
        },
      },
    );
  }

  // 6. Sugerencia. Try/catch general defensivo — un error de red al SDK
  // Anthropic no debe filtrarse como stack trace al cliente.
  try {
    const result = await suggestEppForEmpleado({
      empleadoId: parsedBody.data.empleado_id,
      consultoraId: consultora.id,
      supabase,
    });

    switch (result.kind) {
      case 'empleado_not_found':
        return errorResponse(404, 'EMPLEADO_NOT_FOUND', 'Empleado no encontrado.');
      case 'no_puestos':
        return Response.json(
          {
            suggestions: [],
            reason: 'NO_PUESTOS',
            message:
              'El empleado no tiene puestos asignados. Asigná puestos para recibir sugerencia IA.',
            empleado: result.empleado,
          },
          { status: 200 },
        );
      case 'no_catalogo':
        return Response.json(
          {
            suggestions: [],
            reason: 'NO_CATALOGO',
            message:
              'No hay items EPP disponibles para sugerir (catálogo vacío o todos los items aplicables están dentro de su vida útil).',
            empleado: result.empleado,
            puestos_considerados: result.puestosConsiderados,
          },
          { status: 200 },
        );
      case 'ai_parse_error':
        return errorResponse(
          500,
          'AI_PARSE_ERROR',
          'No pudimos parsear la respuesta de la IA. Intentá nuevamente en unos segundos.',
        );
      case 'ok':
        return Response.json(
          {
            suggestions: result.suggestions,
            puestos_considerados: result.puestosConsiderados,
            catalogo_considerado_count: result.catalogoConsideradoCount,
            recientes_excluidos: result.recientesExcluidos,
            tokens_used: result.tokens,
            model: result.model,
            empleado: result.empleado,
          },
          { status: 200 },
        );
    }
  } catch (err) {
    logger.error(
      { err, consultoraId: consultora.id, empleadoId: parsedBody.data.empleado_id },
      'epp_suggest_unexpected_error',
    );
    return errorResponse(
      500,
      'INTERNAL_ERROR',
      'Error inesperado generando la sugerencia. Reintentá en unos segundos.',
    );
  }
}
