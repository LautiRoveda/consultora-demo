import Anthropic from '@anthropic-ai/sdk';
import { type NextRequest } from 'next/server';

import { runEppChat } from '@/shared/ai/epp-chat';
import { requireMemberWithBilling } from '@/shared/auth/with-billing';
import { logger } from '@/shared/observability/logger';
import { getRateLimiter } from '@/shared/security/rate-limit';
import { createClient } from '@/shared/supabase/server';

import { chatBodySchema } from './schema';

/**
 * T-117 · POST /api/asistente
 *
 * Asistente IA contextual de EPP. Recibe `{ messages }` (historial de texto),
 * valida auth + tenant + billing + rate limit, y corre `runEppChat` (Claude Haiku
 * con tool-calling multi-turno sobre queries sólo-lectura RLS-aware).
 *
 * Gates clonados de `POST /api/epp/sugerir-epp`, pero con `requireMemberWithBilling`
 * (envuelve billing en try/catch — evita el gap T-115 de `requireBillingAccess`).
 *
 * Streaming-ready: el FU de SSE puede cambiar el `messages.create` final del loop
 * por `messages.stream` (helper `src/shared/ai/stream.ts`) sin tocar este contrato.
 *
 * Responses:
 *  - 200 OK `{ answer, capped, tokens_used, model }`.
 *  - 400 INVALID_INPUT · 401 UNAUTHENTICATED · 403 NO_CONSULTORA.
 *  - 402 BILLING_GATED (trial vencido / suscripción).
 *  - 429 RATE_LIMITED (techo por consultora, o IA saturada).
 *  - 500 INTERNAL_ERROR.
 */

// Rate limit por consultora (no por user). El chat es multi-turno (bursty): 15/min
// da aire a una conversación sin abrir la puerta a quema de tokens. Helper canónico
// (Upstash Redis en prod, multi-instancia; noop en dev sin Upstash).
const chatLimiter = getRateLimiter({
  identifier: 'asistente-chat-consultora',
  limit: 15,
  window: '1 m',
});

type ErrorBody = { code: string; message: string };

function errorResponse(status: number, code: string, message: string): Response {
  const body: ErrorBody = { code, message };
  return Response.json(body, { status });
}

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Body.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(400, 'INVALID_INPUT', 'Body inválido (no es JSON).');
  }
  const parsedBody = chatBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return errorResponse(
      400,
      'INVALID_INPUT',
      parsedBody.error.issues[0]?.message ?? 'Body inválido.',
    );
  }

  // 2-4. Auth + consultora + billing (robusto, T-115-safe).
  const supabase = await createClient();
  const pre = await requireMemberWithBilling(supabase);
  if (!pre.ok) {
    if (pre.code === 'BILLING_GATED') {
      logger.info({ code: pre.code, reason: pre.reason }, 'asistente_chat_billing_gated');
      return Response.json(
        { code: pre.code, reason: pre.reason, message: pre.message },
        { status: 402 },
      );
    }
    const status =
      pre.code === 'UNAUTHENTICATED'
        ? 401
        : pre.code === 'NO_CONSULTORA' || pre.code === 'FORBIDDEN_NOT_OWNER'
          ? 403
          : 500;
    return errorResponse(status, pre.code, pre.message);
  }
  const { consultoraId, userId } = pre.ctx;

  // 5. Rate limit por consultora.
  const rl = await chatLimiter.limit(consultoraId);
  if (!rl.success) {
    logger.warn({ userId, consultoraId, code: 'RATE_LIMITED' }, 'asistente_chat_rate_limited');
    return new Response(
      JSON.stringify({
        code: 'RATE_LIMITED',
        message: `Demasiadas consultas. Reintentá en ${rl.retryAfterSeconds}s.`,
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

  // 6. Chat. Try/catch defensivo — un error de red al SDK no debe filtrarse como
  // stack trace al cliente.
  try {
    const result = await runEppChat({
      messages: parsedBody.data.messages,
      consultoraId,
      supabase,
    });
    return Response.json(
      {
        answer: result.answer,
        capped: result.kind === 'iteration_cap_reached',
        tokens_used: result.tokens,
        model: result.model,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      logger.warn({ consultoraId }, 'asistente_chat_anthropic_rate_limited');
      return errorResponse(429, 'RATE_LIMITED', 'La IA está saturada. Reintentá en unos segundos.');
    }
    logger.error({ err, consultoraId }, 'asistente_chat_unexpected_error');
    return errorResponse(
      500,
      'INTERNAL_ERROR',
      'Error inesperado generando la respuesta. Reintentá en unos segundos.',
    );
  }
}
