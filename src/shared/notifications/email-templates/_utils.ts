/**
 * T-074 · Helpers compartidos para templates dunning.
 *
 * - escapeHtml: defense XSS sobre cualquier user input antes de inline en HTML.
 * - formatARS: centavos -> "$X.XXX,XX" es-AR.
 * - formatFechaCorta: ISO timestamptz -> "DD/MM/YYYY" en TZ AR.
 * - renderLayout: wrapper HTML + preheader + header + footer, slot para body.
 *
 * Patron T-031 (reminder-vencimiento): inline CSS table-based 600px,
 * paleta indigo #4f46e5, system stack, mso-hide.
 */
import { formatDateAR } from '@/shared/lib/format-date';

export const LINK_BASE = 'https://consultora-demo.test-ia.cloud';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatARS(centavos: number): string {
  const pesos = centavos / 100;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pesos);
}

export function formatFechaCorta(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatDateAR(d);
}

export type DunningLayoutInput = {
  preheader: string;
  bodyHtml: string;
  ctaText: string;
  ctaUrl: string;
};

export function renderDunningLayout(input: DunningLayoutInput): string {
  const { preheader, bodyHtml, ctaText, ctaUrl } = input;
  const settingsUrl = `${LINK_BASE}/settings/billing`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
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
                    <a href="${ctaUrl}" target="_blank" style="display: inline-block; padding: 12px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; line-height: 1;">${escapeHtml(ctaText)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                Si no podés clickear el botón, copiá esta URL en tu navegador:
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5;">
                <a href="${ctaUrl}" style="color: #4f46e5; text-decoration: underline; word-break: break-all;">${ctaUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; border-top: 1px solid #e4e4e7; font-size: 13px; line-height: 1.5; color: #71717a;">
              <p style="margin: 0 0 8px 0;">ConsultoraDemo · Hecho en Argentina</p>
              <p style="margin: 0;">
                <a href="${settingsUrl}" style="color: #71717a; text-decoration: underline;">Gestioná tu plan y facturación</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};
