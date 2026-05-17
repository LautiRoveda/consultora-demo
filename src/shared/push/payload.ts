/**
 * T-034 · Render del payload Web Push.
 *
 * Push es text plano (a diferencia de Telegram MarkdownV2 o Email HTML).
 * El SW recibe `event.data.json()` y llama showNotification(title, options)
 * donde options.body es text plano y options.data.url tiene el deep-link.
 *
 * Hard limit del Push Service: 4096 bytes JSON.
 * Nuestro render produce ~300-500 bytes típicos. Defensa: si el body excede
 * después del render, el sender (push.ts) lo trunca a 200 chars + `…`.
 */

import type { ReminderWithEvent } from '@/shared/notifications/types';
import type { PushPayload } from './types';

const TIPO_LABELS: Record<string, string> = {
  protocolo_anual: 'Protocolo anual',
  rgrl_anual: 'RGRL anual',
  capacitacion: 'Capacitación',
  calibracion: 'Calibración',
  examen_medico: 'Examen médico',
  epp_entrega: 'EPP — entrega',
  custom: 'Vencimiento',
};

/**
 * Genera el payload para un reminder dado.
 *
 * Decisiones:
 *  - title: prefijo "ConsultoraDemo · " + tipo label (es-AR).
 *  - body: 3 branches según offset_days vs fecha_vencimiento:
 *      offset_days === 0   → "HOY vence: <titulo>"
 *      offset_days > 0     → "Vence en N días: <titulo>"
 *      offset_days === 0 Y fecha < today → "Vencido: <titulo>"
 *  - url: deep-link a /calendario/agenda?event=<id>. El SW lo abre on click.
 *  - tag: `event-<eventId>` — dedupea reminders del MISMO evento (a 30d, 7d,
 *    0d): el browser reemplaza la notif previa si llega otra con tag igual.
 *  - icon: `/favicon.ico` (Q1 cerrada del plan — FU si vale icon dedicado).
 *
 * Sin escape (a diferencia de Telegram MarkdownV2 T-033) — push es text plano,
 * el browser renderea como string sin interpretación.
 */
export function renderPushPayload(args: {
  reminder: ReminderWithEvent;
  deepLink: string;
  todayIso?: string;
}): PushPayload {
  const { reminder, deepLink } = args;
  const event = reminder.event;

  const tipoLabel = TIPO_LABELS[event.tipo] ?? 'Vencimiento';
  const title = `ConsultoraDemo · ${tipoLabel}`;

  // Determinar body según offset + fecha. todayIso por default es hoy del
  // server al momento del send (UTC). Esto matchea la lógica del sender
  // Email/Telegram T-031/T-033.
  const todayIso = args.todayIso ?? new Date().toISOString().slice(0, 10);
  const fecha = event.fecha_vencimiento;
  let body: string;
  if (fecha < todayIso) {
    body = `Vencido: ${event.titulo}`;
  } else if (reminder.offset_days === 0) {
    body = `HOY vence: ${event.titulo}`;
  } else {
    body = `Vence en ${reminder.offset_days} días: ${event.titulo}`;
  }

  return {
    title,
    body,
    url: deepLink,
    tag: `event-${event.id}`,
    icon: '/favicon.ico',
  };
}
