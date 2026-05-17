import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DispatchResult, ReminderWithEvent } from '../types';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';
import { renderPushPayload } from '@/shared/push/payload';
import { getWebPushClient } from '@/shared/push/web-push-client';

/**
 * T-034 · Web Push sender real. Reemplaza el stub T-031.
 *
 * Lookup de push_subscriptions del user (multi-device por design). Para cada
 * sub, envía notification via web-push lib. Mapping de statusCode:
 *  - 200/201 → success.
 *  - 410 Gone / 404 Not Found → subscription expirada → DELETE row (cleanup).
 *  - 413 Payload Too Large → log warn + skip esa sub.
 *  - Otros → log warn + failed esa sub.
 *
 * Multi-device: una sub expirada NO bloquea las otras. Si al menos 1 sub tuvo
 * éxito → return ok. Si todas fallaron → PUSH_ALL_FAILED. Si todas fueron
 * cleanup (expiradas) → PUSH_ALL_EXPIRED + auto-disable pref push.
 *
 * Sin subs en DB del user → PUSH_NO_SUBSCRIPTIONS (skippable code, dispatcher
 * mapea a status='skipped' — no es failure, user simplemente no activó push).
 *
 * Cleanup async (void) — el outcome ya está decidido y no esperamos.
 * Update last_seen_at de las subs exitosas también async.
 */

const PUSH_TTL_SECONDS = 86_400;
const PAYLOAD_MAX_BYTES = 4096;
const STATUS_GONE = 410;
const STATUS_NOT_FOUND = 404;
const STATUS_PAYLOAD_TOO_LARGE = 413;

export async function sendPushReminder(args: {
  reminder: ReminderWithEvent;
  admin: SupabaseClient<Database>;
  userId: string;
}): Promise<DispatchResult> {
  const { reminder, admin, userId } = args;

  // 1. Lookup subscriptions del user.
  const { data: subs, error: selErr } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh_key, auth_key')
    .eq('user_id', userId);

  if (selErr) {
    logger.error({ err: selErr, userId }, 'push sender: select subscriptions falló');
    return {
      ok: false,
      errorCode: 'PUSH_SELECT_FAILED',
      errorDetail: selErr.message,
    };
  }

  if (!subs || subs.length === 0) {
    return {
      ok: false,
      errorCode: 'PUSH_NO_SUBSCRIPTIONS',
      errorDetail: 'User sin subscriptions activas en push_subscriptions',
    };
  }

  // 2. Render payload UNA VEZ (mismo para todos los devices del user).
  //    Deep-link al evento en agenda — el SW lo abre on click.
  const deepLink = `${env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '')}/calendario/agenda?event=${reminder.event.id}`;
  const payload = renderPushPayload({ reminder, deepLink });

  // Defensa 4KB cap (decisión cerrada del plan): si por algun caso edge
  // (titulo absurdo) el payload supera 4KB, truncate body. El renderer
  // típico produce ~300-500 bytes — esto solo se activa con input patológico.
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > PAYLOAD_MAX_BYTES) {
    logger.warn(
      { userId, originalSize: Buffer.byteLength(JSON.stringify(payload)) },
      'push payload > 4KB, truncando body defensivo',
    );
    payload.body = payload.body.slice(0, 200) + '…';
  }

  const payloadJson = JSON.stringify(payload);
  const client = getWebPushClient();

  const successIds: string[] = [];
  const cleanupIds: string[] = [];
  let failedCount = 0;

  // 3. Enviar a cada subscription en serie.
  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
    };

    try {
      const res = await client.sendNotification(subscription, payloadJson, {
        TTL: PUSH_TTL_SECONDS,
      });
      if (res.statusCode === 200 || res.statusCode === 201) {
        successIds.push(sub.id);
      } else {
        logger.warn(
          { userId, subId: sub.id, statusCode: res.statusCode },
          'push: respuesta no esperada del Push Service',
        );
        failedCount++;
      }
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      const statusCode = e?.statusCode ?? 0;

      if (statusCode === STATUS_GONE || statusCode === STATUS_NOT_FOUND) {
        cleanupIds.push(sub.id);
        logger.info(
          { userId, subId: sub.id, statusCode },
          'push subscription expirada/inválida → cleanup',
        );
      } else if (statusCode === STATUS_PAYLOAD_TOO_LARGE) {
        logger.warn({ userId, subId: sub.id }, 'push: payload too large, skip');
        failedCount++;
      } else {
        logger.warn({ err: e?.message, userId, subId: sub.id, statusCode }, 'push send falló');
        failedCount++;
      }
    }
  }

  // 4. Cleanup de subs expiradas (await — determinístico y barato: 1 DELETE).
  //    Si falla, log warn pero no afecta el outcome (la sub queda y se re-
  //    intentará en próximo send + cleanup).
  if (cleanupIds.length > 0) {
    const { error: cleanupErr } = await admin
      .from('push_subscriptions')
      .delete()
      .in('id', cleanupIds);
    if (cleanupErr) {
      logger.warn({ err: cleanupErr, cleanupIds }, 'push cleanup: delete falló');
    }

    // Si TODAS las subs fueron cleanup (sin successes) → auto-disable canal.
    if (cleanupIds.length === subs.length && successIds.length === 0) {
      await admin
        .from('notification_channel_prefs')
        .upsert(
          { user_id: userId, channel: 'push', enabled: false },
          { onConflict: 'user_id,channel' },
        );
    }
  }

  // 5. Update last_seen_at de las subs exitosas (await — determinístico).
  if (successIds.length > 0) {
    await admin
      .from('push_subscriptions')
      .update({ last_seen_at: new Date().toISOString() })
      .in('id', successIds);
  }

  // 6. Outcome decision.
  if (successIds.length > 0) {
    return {
      ok: true,
      messageId: `push:${successIds.length}/${subs.length}`,
    };
  }
  if (cleanupIds.length === subs.length) {
    return {
      ok: false,
      errorCode: 'PUSH_ALL_EXPIRED',
      errorDetail: `Todas las ${subs.length} subscriptions expiraron (cleanup)`,
    };
  }
  // Mix de failed + cleanup, o todos failed.
  return {
    ok: false,
    errorCode: 'PUSH_ALL_FAILED',
    errorDetail: `0/${subs.length} subscriptions exitosas (${failedCount} failed, ${cleanupIds.length} cleanup)`,
  };
}
