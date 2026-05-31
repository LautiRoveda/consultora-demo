import type { RenderedEmail } from './_utils';

import { escapeHtml, LINK_BASE } from './_utils';

/**
 * T-109 · Email digest semanal EPP (lunes 09:00 ART). Resumen por consultora:
 * entregas firmadas en los ultimos 7 dias + proximos vencimientos (7 dias).
 *
 * Layout propio (NO renderDunningLayout, cuyo footer es billing-specific). Mismo
 * estilo visual: table-based 600px, indigo #4f46e5, system stack, mso-hide.
 */

export type EppWeeklySummaryInput = {
  consultoraName: string;
  entregas7d: number;
  // `fecha` ya formateada DD/MM/YYYY (el caller usa format-date AR).
  vencimientos: { empleado: string; item: string; fecha: string }[];
};

export function renderEppWeeklySummaryEmail(input: EppWeeklySummaryInput): RenderedEmail {
  const { consultoraName, entregas7d, vencimientos } = input;
  const safeName = escapeHtml(consultoraName);
  const ctaUrl = `${LINK_BASE}/empleados`;

  const subject = '[ConsultoraDemo] Resumen semanal de EPP';
  const preheader =
    vencimientos.length > 0
      ? `${vencimientos.length} vencimiento(s) de EPP en los proximos 7 dias`
      : 'Resumen semanal de entregas de EPP';

  const vencimientosHtml =
    vencimientos.length === 0
      ? '<p style="margin: 0 0 16px 0; color: #71717a;">Sin vencimientos en los proximos 7 dias.</p>'
      : `<ul style="margin: 0 0 16px 0; padding-left: 20px;">${vencimientos
          .map(
            (v) =>
              `<li style="margin: 0 0 6px 0;"><strong>${escapeHtml(v.empleado)}</strong> — ${escapeHtml(v.item)} <span style="color: #71717a;">(${escapeHtml(v.fecha)})</span></li>`,
          )
          .join('')}</ul>`;

  const bodyHtml = `
              <p style="margin: 0 0 16px 0;">Hola ${safeName},</p>
              <p style="margin: 0 0 16px 0;">Tu resumen semanal de EPP:</p>
              <p style="margin: 0 0 8px 0;"><strong>Entregas firmadas (ultimos 7 dias):</strong> ${entregas7d}</p>
              <p style="margin: 0 0 8px 0;"><strong>Proximos vencimientos (7 dias):</strong></p>
              ${vencimientosHtml}`;

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
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(preheader)}</div>
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
              ${bodyHtml}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
                <tr>
                  <td align="center" bgcolor="#4f46e5" style="border-radius: 6px;">
                    <a href="${ctaUrl}" target="_blank" style="display: inline-block; padding: 12px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; line-height: 1;">Ver empleados</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; border-top: 1px solid #e4e4e7; font-size: 13px; line-height: 1.5; color: #71717a;">
              <p style="margin: 0 0 8px 0;">ConsultoraDemo · Hecho en Argentina</p>
              <p style="margin: 0;">Recibis este resumen porque tenes activas las notificaciones por email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Hola ${consultoraName},`,
    '',
    'Tu resumen semanal de EPP:',
    `- Entregas firmadas (ultimos 7 dias): ${entregas7d}`,
    '- Proximos vencimientos (7 dias):',
    ...(vencimientos.length === 0
      ? ['  Sin vencimientos en los proximos 7 dias.']
      : vencimientos.map((v) => `  ${v.empleado} — ${v.item} (${v.fecha})`)),
    '',
    ctaUrl,
    '',
    '---',
    'ConsultoraDemo · Hecho en Argentina',
  ].join('\n');

  return { subject, html, text };
}
