'use server';

import { revalidatePath } from 'next/cache';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';
import { getTelegramBotClient } from '@/shared/telegram/bot-client';
import { generateLinkCode } from '@/shared/telegram/link-code';

/**
 * T-033 · Server actions para vinculación Telegram desde el UI Settings.
 *
 *  - `generateTelegramLinkCodeAction`: UPSERT con `link_code` nuevo y TTL
 *    15 min. UI muestra el código + deep-link al user.
 *
 *  - `unlinkTelegramAction`: idempotente. Si está linkeado: notifica al
 *    bot, marca `unlinked_at`, limpia chat_id, deshabilita pref telegram.
 *    Si no está linkeado: no-op `{ ok: true }`.
 *
 * RLS de `telegram_subscriptions` permite SELECT/INSERT/UPDATE propios.
 * Usamos service-role solo donde es necesario (UPSERT cross-tabla a
 * `notification_channel_prefs` con bypass del user_id check del current
 * user authed — aunque en realidad NO es estrictamente necesario porque
 * la pref es del mismo user; pero seguimos el patrón del webhook handler
 * que usa service-role para evitar dependencia del JWT en ese endpoint).
 */

const LINK_CODE_TTL_MS = 15 * 60_000;

export type GenerateLinkCodeResult =
  | { ok: true; code: string; deepLink: string; expiresAt: string }
  | { ok: false; code: 'UNAUTHENTICATED' | 'INTERNAL_ERROR'; message: string };

export async function generateTelegramLinkCodeAction(): Promise<GenerateLinkCodeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'UNAUTHENTICATED', message: 'No autenticado.' };

  const linkCode = generateLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();

  // UPSERT por user_id (UNIQUE). Regenera limpio si había código previo
  // o subscription unlinked: nuevo flow start desde cero.
  const { error } = await supabase.from('telegram_subscriptions').upsert(
    {
      user_id: user.id,
      link_code: linkCode,
      link_code_expires_at: expiresAt,
      // Reset campos de un linkeo previo si existiera:
      linked_at: null,
      unlinked_at: null,
      telegram_chat_id: null,
      telegram_username: null,
      blocked_count: 0,
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    logger.error({ err: error, userId: user.id }, 'generateTelegramLinkCodeAction: upsert fallo');
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error generando código.' };
  }

  revalidatePath('/settings/notificaciones');

  return {
    ok: true,
    code: linkCode,
    deepLink: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${linkCode}`,
    expiresAt,
  };
}

export type UnlinkTelegramResult =
  | { ok: true }
  | { ok: false; code: 'UNAUTHENTICATED' | 'INTERNAL_ERROR'; message: string };

export async function unlinkTelegramAction(): Promise<UnlinkTelegramResult> {
  const supabase = await createClient();
  const admin = createServiceRoleClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'UNAUTHENTICATED', message: 'No autenticado.' };

  const { data: sub } = await supabase
    .from('telegram_subscriptions')
    .select('telegram_chat_id, linked_at, unlinked_at')
    .eq('user_id', user.id)
    .maybeSingle();

  // Idempotente: ya unlinked o sin row → ok=true.
  if (!sub || sub.unlinked_at || !sub.linked_at) {
    return { ok: true };
  }

  // Mensaje "Te desvinculaste" antes de clearing chat_id (el bot todavía
  // puede hablarle al user). Best-effort: si falla la notif, igual unlink.
  if (sub.telegram_chat_id) {
    const bot = getTelegramBotClient();
    await bot
      .sendMessage(
        sub.telegram_chat_id,
        'Te desvinculaste. Regenerá vinculación desde la app si querés volver.',
      )
      .catch((err: unknown) =>
        logger.warn({ err, userId: user.id }, 'unlinkTelegramAction: bot notify fallo'),
      );
  }

  const { error: updateErr } = await supabase
    .from('telegram_subscriptions')
    .update({
      unlinked_at: new Date().toISOString(),
      telegram_chat_id: null,
    })
    .eq('user_id', user.id);

  if (updateErr) {
    logger.error(
      { err: updateErr, userId: user.id },
      'unlinkTelegramAction: UPDATE unlinked_at fallo',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error desvinculando.' };
  }

  // Auto-disable canal telegram en prefs (via admin para no depender de
  // RLS en este path crítico).
  await admin
    .from('notification_channel_prefs')
    .upsert(
      { user_id: user.id, channel: 'telegram', enabled: false },
      { onConflict: 'user_id,channel' },
    );

  revalidatePath('/settings/notificaciones');

  return { ok: true };
}
