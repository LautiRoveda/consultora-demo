import type { ReminderWithEvent } from '../types';

/**
 * T-031 · Template HTML inline para email de recordatorio de vencimiento.
 *
 * Patron T-079 (HTML inline + table-based + paleta indigo + system stack +
 * preheader mso-hide). 600px centrado. Reusable across email clients
 * (Gmail / Outlook / Apple Mail / iOS / Android).
 *
 * NO usa markdown rendering — los reminders son notificaciones cortas.
 * Si en T-031-FU se quiere markdown, evaluar `react-email` o
 * `@react-email/components`.
 *
 * NO menciona recurrencia en el subject (decisin del orquestador): si
 * el evento es recurrente, el body del link al detalle muestra esa info.
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
 * Escapa caracteres HTML peligrosos (XSS defense).
 * El titulo y descripcion vienen del user input que paso por Zod en
 * T-028, pero el limite era 200 chars de titulo + 2000 de descripcion;
 * eso no excluye `<script>` o `</a>` que cierran tags del template.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formatea YYYY-MM-DD como "DD de Mes de YYYY" en es-AR.
 */
function formatFechaEs(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const meses = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  return `${d} de ${meses[m - 1]} de ${y}`;
}

function buildSubject(reminder: ReminderWithEvent): string {
  const titulo = reminder.event.titulo;
  if (reminder.offset_days === 0) {
    return `[ConsultoraDemo] HOY vence: ${titulo}`;
  }
  return `[ConsultoraDemo] Vence en ${reminder.offset_days} días: ${titulo}`;
}

export type RenderReminderEmailInput = {
  reminder: ReminderWithEvent;
  recipientName: string | null;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

/**
 * Renderiza el email completo (subject + HTML + text fallback).
 *
 * Footer con link a `/settings/notificaciones` para preferencias.
 * La URL puede dar 404 hasta T-035 — aceptable MVP (defensa contra
 * spam flagging + normaliza UX + cumple data privacy regs anticipado).
 */
export function renderReminderEmail(input: RenderReminderEmailInput): RenderedEmail {
  const { reminder, recipientName } = input;
  const { titulo, tipo, fecha_vencimiento, descripcion } = reminder.event;

  const safeTitulo = escapeHtml(titulo);
  const safeTipoLabel = escapeHtml(tipoLabel(tipo));
  const safeFecha = escapeHtml(formatFechaEs(fecha_vencimiento));
  const safeDescripcion = descripcion ? escapeHtml(descripcion) : null;
  const safeName = recipientName ? escapeHtml(recipientName) : null;

  const eventUrl = `${LINK_BASE}/calendario/agenda?event=${reminder.event.id}`;
  const settingsUrl = `${LINK_BASE}/settings/notificaciones`;

  const greeting = safeName ? `Hola ${safeName},` : 'Hola,';

  const preheaderText =
    reminder.offset_days === 0
      ? `Hoy vence: ${titulo}`
      : `Vence en ${reminder.offset_days} días: ${titulo}`;

  const subject = buildSubject(reminder);

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>ConsultoraDemo</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(preheaderText)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px;">
          <tr>
            <td style="padding: 0 0 20px 0; border-bottom: 1px solid #e4e4e7;">
              <span style="font-size: 18px; font-weight: 700; color: #4f46e5;">ConsultoraDemo</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; font-size: 15px; line-height: 1.55; color: #18181b;">
              <p style="margin: 0 0 16px 0;">${greeting}</p>
              <p style="margin: 0 0 16px 0;">
                Te recordamos que el siguiente vencimiento está próximo:
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0; background-color: #fafafa; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; font-size: 15px; line-height: 1.55; color: #18181b;">
                    <strong style="font-weight: 600;">${safeTipoLabel}:</strong> ${safeTitulo}<br/>
                    <strong style="font-weight: 600;">Fecha:</strong> ${safeFecha}
                    ${safeDescripcion ? `<br/><strong style="font-weight: 600;">Detalle:</strong> ${safeDescripcion}` : ''}
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
                <tr>
                  <td align="center" bgcolor="#4f46e5" style="border-radius: 6px;">
                    <a href="${eventUrl}" target="_blank" style="display: inline-block; padding: 12px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; line-height: 1;">Ver vencimiento en ConsultoraDemo</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                Si no podés clickear el botón, copiá esta URL en tu navegador:
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5;">
                <a href="${eventUrl}" style="color: #4f46e5; text-decoration: underline; word-break: break-all;">${eventUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; border-top: 1px solid #e4e4e7; font-size: 13px; line-height: 1.5; color: #71717a;">
              <p style="margin: 0 0 8px 0;">ConsultoraDemo · Hecho en Argentina</p>
              <p style="margin: 0;">
                <a href="${settingsUrl}" style="color: #71717a; text-decoration: underline;">Modificá tus preferencias de notificaciones</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    greeting.replace(/&[a-z]+;/g, ''),
    '',
    'Te recordamos que el siguiente vencimiento está próximo:',
    '',
    `${tipoLabel(tipo)}: ${titulo}`,
    `Fecha: ${formatFechaEs(fecha_vencimiento)}`,
    ...(descripcion ? [`Detalle: ${descripcion}`] : []),
    '',
    'Ver vencimiento en ConsultoraDemo:',
    eventUrl,
    '',
    '---',
    '¿No querés recibir más estos avisos?',
    settingsUrl,
  ].join('\n');

  return { subject, html, text };
}
