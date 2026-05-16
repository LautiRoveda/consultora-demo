/**
 * T-034 · Tipos compartidos del módulo Push.
 *
 * Sin `server-only` ni `'use client'` — los schemas Zod los consume el
 * Route Handler server + el form Client (PushChannelRow valida el shape
 * antes de POST).
 */

import { z } from 'zod';

/**
 * Shape mínimo que el client envía al POST /api/push/subscribe.
 * Espeja el JSON.parse(JSON.stringify(pushManager.subscribe(...).toJSON())):
 *   { endpoint, keys: { p256dh, auth } }
 *
 * NO incluye expirationTime (Push Service no lo populamos en MVP).
 */
export const PushSubscriptionInputSchema = z.object({
  endpoint: z.string().url('endpoint debe ser una URL válida del Push Service.'),
  keys: z.object({
    p256dh: z.string().min(1, 'p256dh key requerida.'),
    auth: z.string().min(1, 'auth key requerida.'),
  }),
});

export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>;

/**
 * Body del endpoint DELETE /api/push/unsubscribe.
 * Solo necesita endpoint — el server resuelve user_id por sesión.
 */
export const PushUnsubscribeInputSchema = z.object({
  endpoint: z.string().url('endpoint debe ser una URL válida.'),
});

export type PushUnsubscribeInput = z.infer<typeof PushUnsubscribeInputSchema>;

/**
 * Payload que renderPushPayload genera y el SW recibe (event.data.json()).
 *
 * `tag` dedupea notifications: si llega un push con tag idéntico mientras hay
 * una notif previa visible, el browser REEMPLAZA la previa (no apila).
 * Para reminders del calendario usamos tag basado en event_id, así un
 * reminder a 7d + reminder a 0d del mismo evento no apilan 2 notifs.
 */
export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  icon: string;
};
