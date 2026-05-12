'use server';

import type { AiErrorCode, AiUsage } from '@/shared/ai/types';
import type { InformeTipo } from '../schema';
import Anthropic from '@anthropic-ai/sdk';
import { revalidatePath } from 'next/cache';

import { CLAUDE_MODEL, getAnthropicClient } from '@/shared/ai/anthropic';
import { getSystemPromptForTipo } from '@/shared/ai/prompts';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import { INFORME_TIPOS } from '../schema';
import { generateInformeInputSchema, updateInformeInputSchema } from './schema';

/**
 * T-020 · Server actions del editor de contenido de informes.
 *
 * Patron de discriminated union heredado de Sprint 1: las actions NUNCA
 * tiran. El cliente patternmatchea sobre `code` para UX. Errores tecnicos
 * van a logger.error → Sentry.
 */

// =============================================================================
// generateInformeContentAction
// =============================================================================

export type GenerateInformeResult =
  | { ok: true; content: string; usage: AiUsage }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code: Exclude<AiErrorCode, 'INVALID_INPUT'>;
      message: string;
    };

/**
 * Genera contenido para un informe usando Claude.
 *
 * Flow:
 * 1. Zod parse del input.
 * 2. Auth gate (getUser → UNAUTHENTICATED).
 * 3. Consultora gate (getCurrentConsultora → NO_CONSULTORA).
 * 4. Cargar informe (RLS scope → NOT_FOUND si null).
 * 5. Permission gate defensivo: creator O owner. Razon: si el user no
 *    tiene permiso de UPDATE en el informe, no quemamos tokens generando
 *    contenido que tampoco va a poder guardar. La RLS de UPDATE haria
 *    el gate real al guardar, pero queremos UX rapida.
 * 6. Build prompt: system del tipo + user message (opcional).
 * 7. Call Anthropic (single-turn, no streaming, max_tokens=4096).
 * 8. Manejo de stop_reason (refusal → CONTENT_FILTER).
 * 9. Extract text + log usage (sin loggear prompt ni response).
 *
 * NO escribe a DB. El user revisa el contenido en el editor y luego
 * decide guardar via `updateInformeContentAction`.
 */
export async function generateInformeContentAction(
  informeId: string,
  input: unknown,
): Promise<GenerateInformeResult> {
  // 1. Validar input.
  const parsed = generateInformeInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Revisá el contexto opcional.',
    };
  }

  // 2-3. Auth + consultora.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    logger.warn({ userId: user.id }, 'generateInformeContentAction: sin consultora');
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  // 4. Cargar informe (RLS limita a la consultora del JWT).
  const { data: informe, error: loadErr } = await supabase
    .from('informes')
    .select('id, tipo, created_by, consultora_id')
    .eq('id', informeId)
    .maybeSingle();

  if (loadErr) {
    logger.error(
      { err: loadErr, informeId, userId: user.id, consultoraId: consultora.id },
      'generateInformeContentAction: load fallo',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error cargando el informe.' };
  }

  if (!informe) {
    return { ok: false, code: 'NOT_FOUND', message: 'Informe no encontrado.' };
  }

  // 5. Permission gate defensivo (RLS UPDATE policy hace el gate real al guardar).
  const isCreator = informe.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Solo el creador del informe o un owner pueden editarlo.',
    };
  }

  // Validar que el tipo del informe esta en el set conocido (defensivo —
  // la DB tiene check constraint que lo garantiza, pero TypeScript no lo sabe).
  if (!(INFORME_TIPOS as readonly string[]).includes(informe.tipo)) {
    logger.error(
      { informeId, tipo: informe.tipo },
      'generateInformeContentAction: tipo desconocido',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Tipo de informe invalido.' };
  }

  // 6. Build prompt.
  const systemPrompt = getSystemPromptForTipo(informe.tipo as InformeTipo);
  const userMessage =
    parsed.data.userPrompt && parsed.data.userPrompt.length > 0
      ? parsed.data.userPrompt
      : `Generá un borrador genérico de informe tipo "${informe.tipo}".`;

  // 7. Call Anthropic.
  // max_tokens=4096 para fit en Vercel Hobby timeout de 10s. Subir a 8192
  // cuando upgrademos a Pro (issue T-020-FU1).
  const client = getAnthropicClient();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    return mapAnthropicError(err, {
      informeId,
      consultoraId: consultora.id,
      userId: user.id,
    });
  }

  // 8. Stop reason: 'refusal' → CONTENT_FILTER.
  if (response.stop_reason === 'refusal') {
    logger.warn({ informeId, consultoraId: consultora.id, userId: user.id }, 'anthropic_refusal');
    return {
      ok: false,
      code: 'CONTENT_FILTER',
      message:
        'El modelo se rehusó a generar este contenido. Probá con un prompt distinto o un tipo de informe diferente.',
    };
  }

  // 9. Extract text + log usage.
  const content = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const usage: AiUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
  };

  logger.info(
    {
      informeId,
      consultoraId: consultora.id,
      userId: user.id,
      model: response.model,
      stopReason: response.stop_reason,
      ...usage,
    },
    'informe_content_generated',
  );

  return { ok: true, content, usage };
}

/**
 * Mapea excepciones del SDK Anthropic a codes del discriminated union.
 */
function mapAnthropicError(
  err: unknown,
  ctx: { informeId: string; consultoraId: string; userId: string },
): GenerateInformeResult {
  if (err instanceof Anthropic.RateLimitError) {
    logger.warn({ ...ctx }, 'anthropic_rate_limited');
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: 'La IA está saturada. Probá en unos minutos.',
    };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    logger.warn({ ...ctx }, 'anthropic_timeout');
    return {
      ok: false,
      code: 'TIMEOUT',
      message: 'La IA tardó demasiado. Intentá de nuevo.',
    };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    logger.error({ ...ctx }, 'anthropic_auth_failed');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error generando el informe. Reintentá en unos minutos.',
    };
  }
  if (err instanceof Anthropic.APIError) {
    logger.error({ ...ctx, status: err.status }, 'anthropic_api_error');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'La IA falló. Intentá de nuevo.',
    };
  }
  logger.error({ ...ctx, err: String(err) }, 'anthropic_unexpected_error');
  return {
    ok: false,
    code: 'INTERNAL_ERROR',
    message: 'Hubo un error inesperado generando el informe.',
  };
}

// =============================================================================
// updateInformeContentAction
// =============================================================================

export type UpdateInformeContentResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'FORBIDDEN' | 'NOT_FOUND' | 'INTERNAL_ERROR';
      message: string;
    };

/**
 * Guarda el contenido editado en `public.informes.contenido`.
 *
 * RLS UPDATE policy (`informes_update_own_or_owner`) hace el gate real:
 * creator OR consultora owner. Si el usuario no tiene permiso, el UPDATE
 * devuelve 0 filas (sin error explicito) → mapeamos a FORBIDDEN.
 *
 * El trigger `audit_informes_after_update` (post-T-020 migration) captura
 * el cambio en audit_log con before/after data truncado a 500 chars.
 */
export async function updateInformeContentAction(
  informeId: string,
  input: unknown,
): Promise<UpdateInformeContentResult> {
  const parsed = updateInformeInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Revisá el contenido.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  // Cargar informe para distinguir NOT_FOUND vs FORBIDDEN antes del UPDATE.
  const { data: informe } = await supabase
    .from('informes')
    .select('id, created_by')
    .eq('id', informeId)
    .maybeSingle();

  if (!informe) {
    return { ok: false, code: 'NOT_FOUND', message: 'Informe no encontrado.' };
  }

  const isCreator = informe.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Solo el creador del informe o un owner pueden editarlo.',
    };
  }

  // UPDATE. RLS WITH CHECK confirma el permission gate del lado DB.
  const { data, error } = await supabase
    .from('informes')
    .update({ contenido: parsed.data.content })
    .eq('id', informeId)
    .select('id');

  if (error) {
    logger.error(
      { err: error, informeId, userId: user.id, consultoraId: consultora.id },
      'updateInformeContentAction: update fallo',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error guardando el contenido.' };
  }

  if (!data || data.length === 0) {
    // RLS filtro la fila — race con permisos despues del gate pre-UPDATE.
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'No tenés permiso para editar este informe.',
    };
  }

  revalidatePath(`/informes/${informeId}`);
  revalidatePath('/informes');

  logger.info(
    {
      informeId,
      consultoraId: consultora.id,
      userId: user.id,
      contentSize: parsed.data.content.length,
    },
    'informe_content_updated',
  );

  return { ok: true };
}
