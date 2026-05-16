import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DispatchResult, ReminderWithEvent } from '../types';

import { logger } from '@/shared/observability/logger';
import { getTelegramBotClient } from '@/shared/telegram/bot-client';
import { renderTelegramReminder } from '@/shared/telegram/message-templates/reminder-vencimiento';

/**
 * T-033 · Sender Telegram real (reemplaza el stub de T-031).
 *
 * NOTA sobre asimetría con sendEmailReminder: este sender recibe `admin` +
 * `userId` además de `chatId` y `reminder`, a diferencia de email que es
 * puro `{to, recipientName, reminder}`. Razón: el manejo de `blocked_count`
 * y auto-unlink cuando Telegram devuelve HTTP 403 son side-effects intrínsecos
 * al canal Telegram, NO del dispatcher genérico. Meter ese conocimiento en
 * el dispatcher contaminaría el orquestador con detalles channel-specific.
 *
 * Manejo de errores del API Telegram:
 *  - 200 OK → returns `{ok: true, messageId}`.
 *  - 403 (bot bloqueado por user) → incrementa blocked_count. Si llega a 3
 *    consecutivos → auto-unlink (unlinked_at + clear chat_id) + disable pref.
 *  - 429 (rate limit) → returns errorCode TELEGRAM_RATE_LIMITED. NO toca
 *    blocked_count (no es bloqueo del user).
 *  - Otro (400, 500, network) → returns errorCode con prefijo TELEGRAM_.
 *
 * Mensaje: MarkdownV2 con titulo + tipo + fecha + deep-link.
 * disable_web_page_preview=true para que no genere un preview feo del link.
 */

const AUTO_UNLINK_THRESHOLD = 3;

export async function sendTelegramReminder(args: {
  chatId: number;
  reminder: ReminderWithEvent;
  admin: SupabaseClient<Database>;
  userId: string;
}): Promise<DispatchResult> {
  const { chatId, reminder, admin, userId } = args;

  const { text, parseMode } = renderTelegramReminder({ reminder });

  const bot = getTelegramBotClient();
  const result = await bot.sendMessage(chatId, text, {
    parseMode,
    disableWebPagePreview: true,
  });

  if (result.ok) {
    return { ok: true, messageId: result.messageId.toString() };
  }

  // Mapping de errores.
  if (result.httpStatus === 403) {
    // Bot bloqueado por el user. Incrementar blocked_count + auto-unlink si llega a 3.
    const { data: current } = await admin
      .from('telegram_subscriptions')
      .select('blocked_count')
      .eq('user_id', userId)
      .maybeSingle();
    const newCount = (current?.blocked_count ?? 0) + 1;

    const updates: {
      blocked_count: number;
      unlinked_at?: string;
      telegram_chat_id?: null;
    } = { blocked_count: newCount };

    if (newCount >= AUTO_UNLINK_THRESHOLD) {
      updates.unlinked_at = new Date().toISOString();
      updates.telegram_chat_id = null;
      // Auto-disable canal en prefs.
      await admin
        .from('notification_channel_prefs')
        .upsert(
          { user_id: userId, channel: 'telegram', enabled: false },
          { onConflict: 'user_id,channel' },
        );
      logger.warn(
        { userId, chatId, blockedCount: newCount },
        'telegram sender: auto-unlink por 3 bloqueos consecutivos',
      );
    }

    await admin.from('telegram_subscriptions').update(updates).eq('user_id', userId);

    return {
      ok: false,
      errorCode: 'TELEGRAM_FORBIDDEN',
      errorDetail: result.errorMessage,
    };
  }

  if (result.httpStatus === 429) {
    return {
      ok: false,
      errorCode: 'TELEGRAM_RATE_LIMITED',
      errorDetail: result.errorMessage,
    };
  }

  // Otro error (400, 500, network=0).
  return {
    ok: false,
    errorCode: `TELEGRAM_${result.errorCode ?? 'UNKNOWN'}`,
    errorDetail: result.errorMessage,
  };
}
