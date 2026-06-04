import { z } from 'zod';

/**
 * T-117 · Body schema de POST /api/asistente.
 *
 * El chat es **stateless**: el cliente manda TODO el historial en cada request
 * (sólo turnos de texto — los bloques tool_use/tool_result son internos del loop
 * del servidor y nunca viajan por el wire). El último turno debe ser del usuario.
 *
 * Caps de historial defensivos (el cliente debería auto-recortar, pero el borde
 * no confía): hasta 20 mensajes, 2000 chars por mensaje, 12000 chars totales.
 * Mantienen acotado el costo IA (cada iteración del loop reenvía el array).
 */

export const EPP_CHAT_MAX_HISTORY_MESSAGES = 20;
export const EPP_CHAT_MAX_MESSAGE_CHARS = 2000;
export const EPP_CHAT_MAX_TOTAL_CHARS = 12000;

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z
    .string()
    .min(1, 'El mensaje no puede estar vacío.')
    .max(
      EPP_CHAT_MAX_MESSAGE_CHARS,
      `Cada mensaje admite hasta ${EPP_CHAT_MAX_MESSAGE_CHARS} caracteres.`,
    ),
});

export const chatBodySchema = z
  .object({
    messages: z
      .array(chatMessageSchema)
      .min(1, 'Falta el mensaje.')
      .max(
        EPP_CHAT_MAX_HISTORY_MESSAGES,
        `El historial admite hasta ${EPP_CHAT_MAX_HISTORY_MESSAGES} mensajes.`,
      ),
  })
  .superRefine((val, ctx) => {
    const last = val.messages.at(-1);
    if (last && last.role !== 'user') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages'],
        message: 'El último mensaje debe ser del usuario.',
      });
    }
    const totalChars = val.messages.reduce((acc, m) => acc + m.content.length, 0);
    if (totalChars > EPP_CHAT_MAX_TOTAL_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages'],
        message: 'La conversación es demasiado larga. Empezá una nueva.',
      });
    }
  });

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatBody = z.infer<typeof chatBodySchema>;
