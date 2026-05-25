import type { InformeTipo } from '@/app/(app)/informes/schema';
import type { Json } from '@/shared/supabase/types';
import { type NextRequest } from 'next/server';

import { getInformeById } from '@/app/(app)/informes/queries';
import { INFORME_TIPOS } from '@/app/(app)/informes/schema';
import { CLAUDE_MODEL } from '@/shared/ai/anthropic';
import { getSystemPromptForTipo } from '@/shared/ai/prompts';
import { streamAnthropicMessage } from '@/shared/ai/stream';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireBillingAccess } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { logger } from '@/shared/observability/logger';
import { getValidatedClientIp } from '@/shared/security/identify';
import { getRateLimiter } from '@/shared/security/rate-limit';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';
import { getServerTemplate } from '@/shared/templates/registry/server';

import { generateStreamBodySchema } from './schema';

// T-081 · Rate limit AI generation por user_id (NO por IP).
// Razón: users legítimos en red corporativa NATted comparten IP — IP-based
// bloquearía false positives masivos. user_id es la identidad real del costo
// Claude API. 20/1h ≈ USD 50/h de tokens si el atacante hammerea.
const aiGenerationLimiter = getRateLimiter({
  identifier: 'ai-generation-user',
  limit: 20,
  window: '1 h',
});

/**
 * T-025 · POST /api/informes/[id]/generate-stream
 *
 * Generacion de contenido con feedback incremental via Server-Sent Events.
 * Reemplaza el camino productivo de la UI sobre `generateInformeContentAction`
 * (T-020), que queda marcada `@deprecated` hasta T-025-FU1.
 *
 * Permisos: creator del informe O owner de la consultora (mismo gate que el
 * UPDATE de contenido — generar requiere ser quien puede guardar).
 *
 * Flow:
 *  1. Validar `id` UUID.
 *  2. Body: `{ userPrompt }` validado con Zod (max 2000 chars).
 *  3. Auth: getUser → null = 401.
 *  4. Consultora: getCurrentConsultora → null = 403.
 *  5. Cargar informe via RLS → null = 404 (cubre cross-tenant + id inexistente).
 *  6. Validar tipo (defensa contra DB drift).
 *  7. Permission gate: creator O owner.
 *  8. (T-021/T-022) Cargar metadata via registry + render → promptContext.
 *  9. Build prompt: system del tipo + user message (context + notes).
 *  10. Stream Anthropic. El wrapper traduce eventos del SDK → contrato SSE,
 *      llama onComplete con usage + tokens al `message_stop`, llama onAbort
 *      si el cliente corta.
 *  11. Audit log + pino en onComplete (non-blocking, service-role).
 *  12. Response 200 con headers SSE.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ErrorBody = { code: string; message: string };

function errorResponse(status: number, code: string, message: string): Response {
  const body: ErrorBody = { code, message };
  return Response.json(body, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // 1. Path param shape.
  if (!UUID_REGEX.test(id)) {
    return errorResponse(400, 'INVALID_INPUT', 'ID de informe invalido.');
  }

  // 2. Body validation. Parse explicito (request.json() puede tirar si el body
  // no es JSON valido — lo capturamos para devolver 400 limpio).
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(400, 'INVALID_INPUT', 'Body invalido (no es JSON).');
  }
  const parsedBody = generateStreamBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return errorResponse(
      400,
      'INVALID_INPUT',
      parsedBody.error.issues[0]?.message ?? 'Body invalido.',
    );
  }

  // 3. Auth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Iniciá sesión.');
  }

  // 4. Consultora.
  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return errorResponse(403, 'NO_CONSULTORA', 'Tu cuenta no tiene una consultora vinculada.');
  }

  // 4.5. T-073 · Trial gate. Bloqueamos pre-rate-limit y pre-fetch del informe
  // para no consumir cuota / DB cycles si la consultora no puede generar.
  // Status 402 Payment Required.
  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    logger.info(
      { userId: user.id, consultoraId: consultora.id, informeId: id, reason: billing.reason },
      'generate_stream: billing gated',
    );
    return Response.json(
      { code: 'BILLING_GATED', reason: billing.reason, message: getGateMessage(billing.reason) },
      { status: 402 },
    );
  }

  // 5. Cargar informe (RLS scope).
  const informe = await getInformeById(supabase, id);
  if (!informe) {
    return errorResponse(404, 'NOT_FOUND', 'Informe no encontrado.');
  }

  // 6. Tipo defensivo (DB check constraint lo garantiza, TS no lo sabe).
  if (!(INFORME_TIPOS as readonly string[]).includes(informe.tipo)) {
    logger.error({ informeId: id, tipo: informe.tipo }, 'generate_stream: tipo desconocido');
    return errorResponse(500, 'INTERNAL_ERROR', 'Tipo de informe invalido.');
  }
  const tipo = informe.tipo as InformeTipo;

  // 7. Permission gate (creator O owner). Mismo gate que update de contenido
  // — generar requiere ser quien puede guardar.
  const isCreator = informe.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return errorResponse(
      403,
      'FORBIDDEN',
      'Solo el creador del informe o un owner pueden editarlo.',
    );
  }

  // 7.5. T-081 · Rate limit AI generation. Post-permission-gate: cuenta solo
  // intentos válidos del user con permiso. El cliente EditorView ya tiene
  // handling de RATE_LIMITED en handleErrorCode (toast genérico con
  // description que trae el retry hint del backend).
  const rl = await aiGenerationLimiter.limit(user.id);
  if (!rl.success) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, informeId: id, code: 'RATE_LIMITED' },
      'ai_generation_rate_limited',
    );
    return new Response(
      JSON.stringify({
        code: 'RATE_LIMITED',
        message: `Demasiadas generaciones. Reintentá en ${rl.retryAfterSeconds}s.`,
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

  // 8. Cargar metadata via registry + render. Mismo flujo defensivo que la
  // action: schema drift → fallback sin contexto, no bloquea generacion.
  let promptContext = '';
  let hasMetadata = false;
  const tipoEntry = getServerTemplate(tipo);
  if (tipoEntry) {
    const { data: metaRow, error: metaErr } = await supabase
      .from('informe_metadata')
      .select('data')
      .eq('informe_id', id)
      .maybeSingle();

    if (metaErr) {
      logger.warn(
        { err: metaErr, informeId: id, consultoraId: consultora.id, userId: user.id, tipo },
        'generate_stream: metadata_load_failed',
      );
    } else if (metaRow?.data) {
      const parsedMeta = tipoEntry.schema.safeParse(metaRow.data);
      if (parsedMeta.success) {
        promptContext = tipoEntry.render(parsedMeta.data);
        hasMetadata = true;
      } else {
        logger.warn(
          {
            informeId: id,
            consultoraId: consultora.id,
            userId: user.id,
            tipo,
            issueCount: parsedMeta.error.issues.length,
          },
          'generate_stream: metadata_schema_drift',
        );
      }
    }
  }

  // 9. Build prompt.
  const systemPrompt = getSystemPromptForTipo(tipo);
  const userNotes = parsedBody.data.userPrompt?.trim() ?? '';
  const userMessage = buildUserMessage({ promptContext, userNotes, tipo });

  // 10. Stream. El wrapper se encarga del mapping events → SSE + errores.
  const stream = streamAnthropicMessage(
    {
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    },
    {
      signal: request.signal,
      ctx: { informeId: id, consultoraId: consultora.id, userId: user.id },
      callbacks: {
        onComplete: (info) => {
          // 11. Pino + audit log non-blocking. Mismo action `informe_content_generated`
          // que T-020 — el cliente del dashboard no se entera del cambio.
          logger.info(
            {
              informeId: id,
              consultoraId: consultora.id,
              userId: user.id,
              tipo,
              model: info.model,
              stopReason: info.stopReason,
              hasMetadata,
              ...info.usage,
              ms: info.ms,
              bytes: info.bytesEmitted,
              chunks: info.chunksEmitted,
            },
            'informe_content_generated',
          );
          void writeAuditLog({
            consultoraId: consultora.id,
            userId: user.id,
            informeId: id,
            titulo: informe.titulo,
            tipo,
            model: info.model,
            stopReason: info.stopReason ?? 'end_turn',
            hasMetadata,
            usage: info.usage,
            bytesEmitted: info.bytesEmitted,
            chunksEmitted: info.chunksEmitted,
            ms: info.ms,
            // C8 audit · IP validada antes de INSERT (audit_log.ip es `inet`).
            ip: getValidatedClientIp(request),
            userAgent: request.headers.get('user-agent'),
          });
        },
        onAbort: (info) => {
          logger.info(
            {
              informeId: id,
              consultoraId: consultora.id,
              userId: user.id,
              tipo,
              ms: info.ms,
              bytes_emitted: info.bytesEmitted,
              chunks_emitted: info.chunksEmitted,
            },
            'informe_content_generation_aborted',
          );
        },
      },
    },
  );

  // 12. Response SSE.
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Desactiva buffering en proxies (Nginx, etc.). EasyPanel hoy va
      // directo a Next pero es defensivo si en el futuro metemos reverse proxy.
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Combina prompt context (metadata renderizada) y user notes (textarea libre)
 * en un solo user message. Logica espejo de `buildUserMessage` en
 * actions.ts:263 — duplicacion intencional hasta T-025-FU1, momento en que la
 * action se remueve y este queda como single source of truth.
 */
function buildUserMessage(args: {
  promptContext: string;
  userNotes: string;
  tipo: InformeTipo;
}): string {
  const { promptContext, userNotes, tipo } = args;
  if (promptContext && userNotes) {
    return `${promptContext}\n\n---\n\n## Notas adicionales del consultor\n\n${userNotes}`;
  }
  if (promptContext) return promptContext;
  if (userNotes) return userNotes;
  return `Generá un borrador genérico de informe tipo "${tipo}".`;
}

type AuditLogArgs = {
  consultoraId: string;
  userId: string;
  informeId: string;
  titulo: string;
  tipo: InformeTipo;
  model: string;
  stopReason: string;
  hasMetadata: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  bytesEmitted: number;
  chunksEmitted: number;
  ms: number;
  ip: string | null;
  userAgent: string | null;
};

async function writeAuditLog(args: AuditLogArgs): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const afterData: Json = {
      titulo: args.titulo,
      tipo: args.tipo,
      model: args.model,
      stop_reason: args.stopReason,
      has_metadata: args.hasMetadata,
      input_tokens: args.usage.inputTokens,
      output_tokens: args.usage.outputTokens,
      cache_read_input_tokens: args.usage.cacheReadInputTokens,
      cache_creation_input_tokens: args.usage.cacheCreationInputTokens,
      bytes_emitted: args.bytesEmitted,
      chunks_emitted: args.chunksEmitted,
      generation_ms: args.ms,
      stream: true,
    };
    const { error } = await admin.from('audit_log').insert({
      consultora_id: args.consultoraId,
      actor_user_id: args.userId,
      action: 'informe_content_generated',
      entity_type: 'informes',
      entity_id: args.informeId,
      after_data: afterData,
      user_agent: args.userAgent,
      ip: args.ip ?? null,
    });
    if (error) {
      logger.error(
        { err: error, informeId: args.informeId, consultoraId: args.consultoraId },
        'generate_stream: audit_log insert fallo (non-blocking)',
      );
    }
  } catch (err) {
    logger.error(
      { err: String(err), informeId: args.informeId, consultoraId: args.consultoraId },
      'generate_stream: audit_log unexpected error (non-blocking)',
    );
  }
}
