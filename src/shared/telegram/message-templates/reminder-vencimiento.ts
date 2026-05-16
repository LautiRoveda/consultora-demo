import type { ReminderEventShape, ReminderWithEvent } from '@/shared/notifications/types';

import { escapeMarkdownV2 } from '../escape-markdownv2';

/**
 * T-033 · Template MarkdownV2 para reminder Telegram.
 *
 * Layout (per discovery § 6.2 / § 8.7):
 *
 *   *<titulo escapado>*
 *
 *   <Tipo>: <Vence en N días | HOY vence | Vencido>
 *   Fecha: <DD\\-MM\\-YYYY escapado>
 *
 *   [Ver en ConsultoraDemo](<deepLink>)
 *
 * NOTA: el titulo SE escapa porque va dentro de un `*bold*`. Si Claude/user
 * mete `_` o `*` literal en el titulo y no lo escapamos, Telegram intenta
 * parsearlo como sintaxis y rompe el mensaje entero (returns 400 BadRequest).
 *
 * El link URL NO se escapa con escapeMarkdownV2 (URLs son raw inside `()`).
 * Defense in depth: deeplink se construye con event.id que es UUID hex,
 * no contiene chars reservados.
 */

const LINK_BASE = 'https://consultora-demo.test-ia.cloud';

const TIPO_LABELS: Record<string, string> = {
  protocolo_anual: 'Protocolo anual',
  epp_entrega: 'Entrega de EPP',
  capacitacion: 'Capacitación',
  calibracion: 'Calibración',
  examen_medico: 'Examen médico',
  rgrl_anual: 'RGRL anual',
  custom: 'Vencimiento',
};

function tipoLabel(tipo: string): string {
  return TIPO_LABELS[tipo] ?? 'Vencimiento';
}

/**
 * Formatea YYYY-MM-DD como DD-MM-YYYY (formato es-AR común).
 * El `-` queda en el output — el caller debe escapar con escapeMarkdownV2.
 */
function formatFechaDmy(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

function buildOffsetLabel(offsetDays: number, fechaIso: string, nowIso: string): string {
  if (offsetDays === 0) {
    return 'HOY vence';
  }
  // Defensive: si por race condition el reminder se procesa después del vencimiento,
  // mostrar "Vencido" en lugar de "Vence en -N días".
  if (fechaIso < nowIso) {
    return 'Vencido';
  }
  return `Vence en ${offsetDays} días`;
}

export type RenderTelegramReminderInput = {
  reminder: ReminderWithEvent;
  /** Fecha actual ISO YYYY-MM-DD para decidir HOY/vencido vs N días. Default = today UTC. */
  todayIso?: string;
};

export type RenderedTelegramMessage = {
  text: string;
  parseMode: 'MarkdownV2';
  deepLink: string;
};

export function renderTelegramReminder(
  input: RenderTelegramReminderInput,
): RenderedTelegramMessage {
  const { reminder, todayIso } = input;
  const event: ReminderEventShape = reminder.event;
  const now = todayIso ?? new Date().toISOString().slice(0, 10);

  const deepLink = `${LINK_BASE}/calendario/agenda?event=${event.id}`;

  const safeTitulo = escapeMarkdownV2(event.titulo);
  const safeTipoLabel = escapeMarkdownV2(tipoLabel(event.tipo));
  const safeFecha = escapeMarkdownV2(formatFechaDmy(event.fecha_vencimiento));
  const offsetLabel = buildOffsetLabel(reminder.offset_days, event.fecha_vencimiento, now);
  const safeOffsetLabel = escapeMarkdownV2(offsetLabel);

  // Telegram MarkdownV2 link: [text](url). Texto SI debe ser escapado, URL NO.
  // Discovery § 8.7 sugiere "[Ver en ConsultoraDemo](...)".
  const linkLabel = escapeMarkdownV2('Ver en ConsultoraDemo');

  const text = [
    `*${safeTitulo}*`,
    '',
    `${safeTipoLabel}: ${safeOffsetLabel}`,
    `Fecha: ${safeFecha}`,
    '',
    `[${linkLabel}](${deepLink})`,
  ].join('\n');

  return {
    text,
    parseMode: 'MarkdownV2',
    deepLink,
  };
}
