import 'server-only';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';

/**
 * T-033 · Cliente Telegram Bot API minimalista.
 *
 * **Server-only.** El `server-only` del tope asegura que un Client Component
 * que importe este modulo rompe el build de Next.js. Defensa en profundidad
 * contra leak de `TELEGRAM_BOT_TOKEN` al bundle del cliente.
 *
 * Singleton lazy (patron T-020 anthropic / T-031 resend): la primera
 * invocacion instancia, las siguientes reusan.
 *
 * NO usa SDK. La Bot API es REST simple — fetch nativo + 3 metodos cubre
 * todo lo que necesitamos (sendMessage, setWebhook, getMe). Cero dep nueva.
 *
 * Doc oficial: https://core.telegram.org/bots/api
 */

type SendMessageOptions = {
  parseMode?: 'MarkdownV2' | 'HTML';
  disableWebPagePreview?: boolean;
};

type SendMessageResult =
  | { ok: true; messageId: number }
  | { ok: false; httpStatus: number; errorCode: string | null; errorMessage: string };

export interface TelegramBotClient {
  sendMessage: (
    chatId: number,
    text: string,
    options?: SendMessageOptions,
  ) => Promise<SendMessageResult>;
  setWebhook: (url: string, secretToken: string) => Promise<{ ok: boolean; description?: string }>;
  getMe: () => Promise<{ ok: boolean; username?: string; description?: string }>;
}

const BASE_URL = 'https://api.telegram.org';

let cachedClient: TelegramBotClient | null = null;

export function getTelegramBotClient(): TelegramBotClient {
  if (cachedClient) return cachedClient;

  const token = env.TELEGRAM_BOT_TOKEN;

  const sendMessage = async (
    chatId: number,
    text: string,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> => {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode,
      disable_web_page_preview: options?.disableWebPagePreview ?? false,
    };

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      logger.warn({ err, chatId }, 'telegram sendMessage: network error');
      return {
        ok: false,
        httpStatus: 0,
        errorCode: 'NETWORK_ERROR',
        errorMessage: err instanceof Error ? err.message : 'unknown network error',
      };
    }

    const parsed = (await response.json().catch(() => null)) as
      | { ok: true; result: { message_id: number } }
      | { ok: false; error_code: number; description: string }
      | null;

    if (response.ok && parsed?.ok) {
      return { ok: true, messageId: parsed.result.message_id };
    }

    // Telegram devuelve siempre {ok, error_code, description} en errores.
    // Mapeo a nuestro shape: httpStatus = HTTP status code real,
    // errorCode = nombre derivado (FORBIDDEN, BAD_REQUEST, etc).
    const errorMessage = parsed && !parsed.ok ? parsed.description : 'unknown error';
    const errorCode = httpStatusToCode(response.status);
    return {
      ok: false,
      httpStatus: response.status,
      errorCode,
      errorMessage,
    };
  };

  const setWebhook = async (url: string, secretToken: string) => {
    const response = await fetch(`${BASE_URL}/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, secret_token: secretToken }),
    });
    const parsed = (await response.json().catch(() => null)) as
      | { ok: true; description: string }
      | { ok: false; description: string }
      | null;
    return {
      ok: response.ok && parsed?.ok === true,
      description: parsed?.description,
    };
  };

  const getMe = async () => {
    const response = await fetch(`${BASE_URL}/bot${token}/getMe`);
    const parsed = (await response.json().catch(() => null)) as
      | { ok: true; result: { username: string } }
      | { ok: false; description: string }
      | null;
    if (response.ok && parsed?.ok) {
      return { ok: true, username: parsed.result.username };
    }
    return { ok: false, description: parsed && !parsed.ok ? parsed.description : 'unknown' };
  };

  cachedClient = { sendMessage, setWebhook, getMe };
  return cachedClient;
}

function httpStatusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      return status >= 500 ? 'SERVER_ERROR' : 'UNKNOWN';
  }
}

/**
 * Reset del singleton — solo para tests. NO usar en código productivo.
 */
export function _resetTelegramBotClientForTests(): void {
  cachedClient = null;
}
