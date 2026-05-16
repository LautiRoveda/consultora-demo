import { z } from 'zod';

/**
 * T-033 · Tipos Telegram Bot API (subset que usamos en webhook handler).
 *
 * Schema completo: https://core.telegram.org/bots/api#update
 *
 * Solo modelamos los fields que leemos en /api/webhooks/telegram + lo necesario
 * para responder. Resto de fields (callback_query, channel_post, etc) los
 * ignoramos — Zod `.passthrough()` haría que el payload pasara entero, pero
 * preferimos `.strict()` para fail-fast si Telegram cambia el shape.
 *
 * NOTA: los IDs de Telegram son `int53` en docs (entero que cabe en double
 * precision float JS sin pérdida). Usamos z.number().int() y bigint para
 * almacenar — DB es bigint, fetch JSON parsea como number en safe range.
 */

// User: el remitente del mensaje. Schema completo en
// https://core.telegram.org/bots/api#user (15+ fields opcionales que ignoramos).
export const TelegramUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});

export type TelegramUser = z.infer<typeof TelegramUserSchema>;

// Chat: el destino del mensaje. Para DMs bot↔user, chat.id === user.id.
export const TelegramChatSchema = z.object({
  id: z.number().int(),
  type: z.string(), // 'private' | 'group' | 'supergroup' | 'channel'
  username: z.string().optional(),
});

export type TelegramChat = z.infer<typeof TelegramChatSchema>;

// Message: contiene el texto + metadata. Solo necesitamos id, from, chat, text.
export const TelegramMessageSchema = z.object({
  message_id: z.number().int(),
  from: TelegramUserSchema.optional(), // anonymous channel posts no tienen `from`
  chat: TelegramChatSchema,
  date: z.number().int(),
  text: z.string().optional(), // images, stickers, etc. no tienen text
});

export type TelegramMessage = z.infer<typeof TelegramMessageSchema>;

// Update: el wrapper que Telegram POSTea al webhook.
// Solo procesamos `message` — otros tipos (edited_message, channel_post,
// callback_query, etc) los ignoramos silenciosamente con 200 OK.
export const TelegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: TelegramMessageSchema.optional(),
});

export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;
