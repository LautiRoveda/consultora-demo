import 'server-only';

import webPush from 'web-push';

import { env } from '@/env';

/**
 * T-034 · Cliente Web Push lazy singleton.
 *
 * **Server-only.** El `server-only` del tope asegura que un Client Component
 * que importe este módulo rompe el build (defensa contra leak de
 * `VAPID_PRIVATE_KEY` al bundle del cliente).
 *
 * Singleton lazy (patrón T-020 anthropic / T-031 resend / T-033 telegram):
 * la primera invocación setea VAPID details + cachea; las siguientes reusan.
 *
 * web-push library handlea internamente:
 *  - Encripción del payload con la public key del browser (p256dh + auth).
 *  - Firma JWT con la VAPID private key.
 *  - HTTP POST al endpoint del Push Service (FCM / Mozilla autopush / Edge).
 *
 * Retorna {statusCode, headers, body} o throwea WebPushError con statusCode
 * propagado. Nuestro sender (push.ts) mapea statusCode → outcome.
 */

let cachedConfigured = false;

/**
 * Lazy init: setea VAPID details la primera vez que se llama.
 * Retorna el namespace `webPush` que expone `sendNotification(sub, payload, opts)`.
 */
export function getWebPushClient(): typeof webPush {
  if (!cachedConfigured) {
    webPush.setVapidDetails(
      env.VAPID_SUBJECT,
      env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    );
    cachedConfigured = true;
  }
  return webPush;
}

/**
 * Reset del singleton — solo para tests. NO usar en código productivo.
 */
export function _resetWebPushClientForTests(): void {
  cachedConfigured = false;
}
