import { z } from 'zod';

import { EPP_CHAT_MAX_MESSAGE_CHARS } from '@/app/api/asistente/schema';

/**
 * T-126 · Schemas de la persistencia del chat del asistente.
 *
 * El chat se persiste client-driven (Option C, RFC T-126): el cliente llama a
 * `persistChatTurnAction` en sus puntos de commit (done -> answer completo; abort
 * con parcial -> parcial) con el turno EXACTO que mostró. El route/orquestador del
 * stream NO conocen estas tablas, así que el `conversacionId` nunca viaja por el
 * route — vive sólo en el action.
 */

/** Turno de chat (user o assistant). Compartido cliente <-> server. */
export type Turn = { role: 'user' | 'assistant'; content: string };

/**
 * Cap del answer assistant a nivel app. La DB lo limita a 8000
 * (ver migración 20260606000001); el answer real está acotado por
 * EPP_CHAT_MAX_TOKENS=1024 (~4k chars), 8000 es headroom defensivo.
 */
export const CHAT_ASSISTANT_MAX_CHARS = 8000;

export const conversacionIdSchema = z.string().uuid({ message: 'UUID inválido.' });

export const persistTurnSchema = z.object({
  // null => crear una conversación nueva (título derivado del userMessage).
  conversacionId: z.string().uuid({ message: 'UUID inválido.' }).nullable(),
  userMessage: z.string().min(1).max(EPP_CHAT_MAX_MESSAGE_CHARS),
  assistantMessage: z.string().min(1).max(CHAT_ASSISTANT_MAX_CHARS),
});

export type PersistTurnInput = z.infer<typeof persistTurnSchema>;
