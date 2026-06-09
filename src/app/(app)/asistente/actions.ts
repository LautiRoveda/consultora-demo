'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import { conversacionIdSchema, persistTurnSchema } from './schema';

/**
 * T-126 · Server actions de la persistencia del chat del asistente (Option C).
 *
 * `persistChatTurnAction` guarda un turno (user + assistant) como par atómico,
 * llamado por el cliente en sus puntos de commit. NUNCA tira: devuelve un
 * discriminated union. Corre con el supabase RLS-aware del usuario (defensa en
 * profundidad: aunque el cliente provea el contenido, sólo escribe en SUS propias
 * conversaciones — chat privado por user).
 */

const RLS_VIOLATION_CODE = '42501';
const CHECK_VIOLATION_CODE = '23514';

/** Tope del título derivado (la DB exige length(trim) entre 1 y 120). */
const CHAT_TITULO_MAX_CHARS = 80;

export type PersistChatTurnResult =
  | { ok: true; conversacionId: string }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'NOT_FOUND' | 'INTERNAL_ERROR';
      message: string;
    };

export type ArchiveChatConversacionResult =
  | { ok: true; conversacionId: string }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'NOT_FOUND' | 'INTERNAL_ERROR';
      message: string;
    };

/** Título = primer mensaje del usuario truncado (sin model call). Fallback si vacío. */
function deriveTitulo(userMessage: string): string {
  const trimmed = userMessage.trim().slice(0, CHAT_TITULO_MAX_CHARS).trim();
  return trimmed.length > 0 ? trimmed : 'Conversación';
}

export async function persistChatTurnAction(input: unknown): Promise<PersistChatTurnResult> {
  const parsed = persistTurnSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Turno inválido.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    logger.warn({ userId: user.id }, 'persistChatTurnAction: user without consultora');
    return { ok: false, code: 'NO_CONSULTORA', message: 'No tenés una consultora asociada.' };
  }

  const { conversacionId, userMessage, assistantMessage } = parsed.data;

  // 1. Crear-o-reusar la conversación.
  let convId: string;
  if (conversacionId === null) {
    const { data, error } = await supabase
      .from('chat_conversaciones')
      .insert({
        consultora_id: consultora.id,
        user_id: user.id,
        titulo: deriveTitulo(userMessage),
      })
      .select('id')
      .single();
    if (error || !data) {
      logger.error(
        { err: error, userId: user.id, consultoraId: consultora.id },
        'persistChatTurnAction: create conversation failed',
      );
      return { ok: false, code: 'INTERNAL_ERROR', message: 'No se pudo guardar la conversación.' };
    }
    convId = data.id;
  } else {
    // Defensivo: la RLS oculta conversaciones ajenas -> null si no es del usuario.
    // No creamos una nueva en silencio (sería un id fantasma para el cliente).
    const { data: existing } = await supabase
      .from('chat_conversaciones')
      .select('id')
      .eq('id', conversacionId)
      .maybeSingle();
    if (!existing) {
      return { ok: false, code: 'NOT_FOUND', message: 'Conversación no encontrada.' };
    }
    convId = existing.id;
  }

  // 2. Insertar los 2 mensajes en UN statement: el orden del array determina `seq`
  //    (user < assistant), que es como las queries ordenan el historial.
  const { error: msgError } = await supabase.from('chat_mensajes').insert([
    {
      conversacion_id: convId,
      consultora_id: consultora.id,
      user_id: user.id,
      role: 'user',
      content: userMessage,
    },
    {
      conversacion_id: convId,
      consultora_id: consultora.id,
      user_id: user.id,
      role: 'assistant',
      content: assistantMessage,
    },
  ]);
  if (msgError) {
    if (msgError.code === RLS_VIOLATION_CODE || msgError.code === CHECK_VIOLATION_CODE) {
      logger.warn(
        { err: msgError.message, userId: user.id, consultoraId: consultora.id, convId },
        'persistChatTurnAction: messages rejected (RLS/CHECK drift)',
      );
    } else {
      logger.error(
        { err: msgError, userId: user.id, consultoraId: consultora.id, convId },
        'persistChatTurnAction: insert messages failed',
      );
    }
    return { ok: false, code: 'INTERNAL_ERROR', message: 'No se pudo guardar el mensaje.' };
  }

  // 3. Bump de updated_at SOLO al reusar (una conversación nueva ya tiene
  //    updated_at = now() del insert). Dispara set_updated_at -> el sidebar ordena
  //    por actividad reciente.
  if (conversacionId !== null) {
    await supabase
      .from('chat_conversaciones')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId);
  }

  // NO revalidatePath acá: pelearía con el stream/remount del cliente. El cliente
  // dispara router.refresh() en un momento controlado (post-stream).
  logger.info(
    {
      conversacionId: convId,
      userId: user.id,
      consultoraId: consultora.id,
      created: conversacionId === null,
    },
    'persistChatTurnAction: turn persisted',
  );
  return { ok: true, conversacionId: convId };
}

export async function archiveChatConversacionAction(
  input: unknown,
): Promise<ArchiveChatConversacionResult> {
  const parsed = conversacionIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'ID inválido.' };
  }
  const conversacionId = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return { ok: false, code: 'NO_CONSULTORA', message: 'No tenés una consultora asociada.' };
  }

  const { data: existing } = await supabase
    .from('chat_conversaciones')
    .select('id')
    .eq('id', conversacionId)
    .maybeSingle();
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Conversación no encontrada.' };
  }

  const { data, error } = await supabase
    .from('chat_conversaciones')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', conversacionId)
    .select('id')
    .single();
  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, conversacionId },
      'archiveChatConversacionAction: archive failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'No se pudo archivar la conversación.' };
  }

  revalidatePath('/asistente');
  logger.info(
    { conversacionId, userId: user.id, consultoraId: consultora.id },
    'archiveChatConversacionAction: archived',
  );
  return { ok: true, conversacionId };
}
