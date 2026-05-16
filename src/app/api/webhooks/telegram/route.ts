import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';
import { createServiceRoleClient } from '@/shared/supabase/service-role';
import { getTelegramBotClient } from '@/shared/telegram/bot-client';
import { LINK_CODE_LENGTH } from '@/shared/telegram/link-code';
import { TelegramUpdateSchema } from '@/shared/telegram/types';

/**
 * T-033 · Webhook handler de Telegram Bot API.
 *
 * Telegram POSTea updates a este endpoint cuando el bot recibe un mensaje.
 * Endpoint registrado via `setWebhook` con secret_token (validado en cada
 * POST via header X-Telegram-Bot-Api-Secret-Token).
 *
 * Comandos soportados:
 *  - `/start <code>` — claim del link_code via atomic UPDATE + UPSERT prefs.
 *  - `/unlink` — soft-unlink del usuario actual.
 *  - Cualquier otro texto → mensaje de instrucción genérica.
 *
 * Idempotencia: el atomic UPDATE garantiza que un retry de Telegram (si
 * nuestro endpoint tardó > 60s en responder) no produzca doble-link.
 * Ver Ajuste 2 del plan: pre-check de chat_id ya linkeado para evitar
 * "código inválido" UX-confuso si Telegram reintenta DESPUÉS del link OK.
 *
 * Response: SIEMPRE 200 OK con body `{ ok: true }` para que Telegram no
 * reintente (excepto 401 si el secret_token es inválido).
 *
 * Doc: https://core.telegram.org/bots/api#setwebhook
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Regex para `/start <code>`: 8 chars del alfabeto sin ambiguos.
// `^` y `$` anchored, `i` NO porque alfabeto es uppercase only.
const START_CMD_REGEX = new RegExp(`^/start\\s+([A-Z2-9]{${LINK_CODE_LENGTH}})$`);

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Validación secret header (defense in depth contra spoofers).
  const providedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!providedSecret || providedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
    logger.warn(
      { hasHeader: Boolean(providedSecret) },
      'telegram webhook: secret invalido o ausente',
    );
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // 2. Parse body como TelegramUpdate.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.warn('telegram webhook: body no es JSON valido');
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = TelegramUpdateSchema.safeParse(body);
  if (!parsed.success) {
    // Logueamos pero respondemos 200 para que Telegram NO reintente.
    logger.warn(
      { errors: parsed.error.flatten() },
      'telegram webhook: shape invalido, ignorando update',
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const update = parsed.data;
  const message = update.message;

  // 3. Edge cases: update sin message (edited_message, callback_query, etc),
  //    o sin from (anonymous channel posts), o sin text (image/sticker).
  if (!message?.from?.id || !message.text) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const chatId = message.from.id;
  const username = message.from.username ?? null;
  const text = message.text.trim();
  const admin = createServiceRoleClient();
  const bot = getTelegramBotClient();

  // 4. Switch comandos.
  const startMatch = text.match(START_CMD_REGEX);
  if (startMatch) {
    const submittedCode = startMatch[1]!;

    // **AJUSTE 2 del plan T-033**: Pre-check chat_id ya linkeado.
    //
    // Caso: Telegram reintenta el webhook (si el endpoint tardó > 60s en
    // responder o cayó). El primer call ya hizo el UPDATE atomic + linkeo
    // el chat. El segundo call viene con el mismo chat_id Y el mismo code,
    // pero el WHERE `linked_at IS NULL` filtra → 0 rows → respondería
    // "código inválido" — UX confusa.
    //
    // Pre-check: si chat_id ya tiene una row linkeada activa, asumimos
    // re-entry de Telegram y respondemos "ya estás vinculado".
    const { data: alreadyLinked } = await admin
      .from('telegram_subscriptions')
      .select('id')
      .eq('telegram_chat_id', chatId)
      .not('linked_at', 'is', null)
      .is('unlinked_at', null)
      .maybeSingle();

    if (alreadyLinked) {
      await bot.sendMessage(
        chatId,
        '✅ Ya estás vinculado. Te aviso por acá cuando tengas vencimientos próximos.',
      );
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Atomic claim: UPDATE solo matchea si link_code está pending Y no expiró.
    // Si 2 messages llegan simultáneo con mismo code, solo el primero gana
    // (Postgres serializa los UPDATE con MVCC).
    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from('telegram_subscriptions')
      .update({
        telegram_chat_id: chatId,
        telegram_username: username,
        linked_at: nowIso,
        link_code: null,
        link_code_expires_at: null,
        unlinked_at: null,
        blocked_count: 0,
      })
      .eq('link_code', submittedCode)
      .is('linked_at', null)
      .gt('link_code_expires_at', nowIso)
      .select('user_id')
      .maybeSingle();

    if (claimErr) {
      logger.error({ err: claimErr, chatId }, 'telegram webhook: error en UPDATE claim de /start');
      // No le decimos al user "DB error" — respondemos genérico.
      await bot.sendMessage(
        chatId,
        '❌ Tuvimos un problema procesando tu código. Probá generar uno nuevo desde la app.',
      );
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (claimed) {
      // Auto-enable canal Telegram en prefs (decisión 4 del plan T-033).
      await admin
        .from('notification_channel_prefs')
        .upsert(
          { user_id: claimed.user_id, channel: 'telegram', enabled: true },
          { onConflict: 'user_id,channel' },
        );

      await bot.sendMessage(
        chatId,
        '✅ Listo! Te aviso por acá cuando tengas vencimientos próximos.',
      );
      logger.info(
        { userId: claimed.user_id, chatId, hasUsername: Boolean(username) },
        'telegram link OK',
      );
    } else {
      await bot.sendMessage(
        chatId,
        '❌ Código inválido o expirado. Generá uno nuevo desde la app.',
      );
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (text === '/unlink') {
    // Buscar subscription por chat_id linkeado.
    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('id, user_id')
      .eq('telegram_chat_id', chatId)
      .not('linked_at', 'is', null)
      .is('unlinked_at', null)
      .maybeSingle();

    if (sub) {
      // Mensaje "Te desvinculaste" ANTES del UPDATE — el bot todavía
      // puede hablarle al user (chat_id sigue válido). Si lo mandamos
      // después de clearing chat_id, ya no podríamos.
      await bot.sendMessage(
        chatId,
        'Te desvinculaste. Regenerá vinculación desde la app si querés volver.',
      );

      await admin
        .from('telegram_subscriptions')
        .update({
          unlinked_at: new Date().toISOString(),
          telegram_chat_id: null,
        })
        .eq('id', sub.id);

      // Auto-disable canal en prefs.
      await admin
        .from('notification_channel_prefs')
        .upsert(
          { user_id: sub.user_id, channel: 'telegram', enabled: false },
          { onConflict: 'user_id,channel' },
        );
      logger.info({ userId: sub.user_id, chatId }, 'telegram unlink OK');
    } else {
      await bot.sendMessage(chatId, 'No te encuentro vinculado. Generá un código desde la app.');
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // 5. Cualquier otro texto: instrucción genérica.
  await bot.sendMessage(
    chatId,
    'Hola! Soy el bot de ConsultoraDemo. Vinculá tu cuenta enviando `/start <código>` (el código lo generás desde Configuración → Notificaciones).',
  );
  return NextResponse.json({ ok: true }, { status: 200 });
}
