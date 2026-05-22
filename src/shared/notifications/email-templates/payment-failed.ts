import type { RenderedEmail } from './_utils';

import { escapeHtml, formatARS, renderDunningLayout } from './_utils';

/**
 * T-074 · Email dunning: pago fallido.
 *
 * Sync trigger desde webhook MP cuando una factura entra estado=fallida.
 * Incluye monto + razon (mp status_detail) si esta disponible.
 */

export type RenderPaymentFailedInput = {
  consultoraName: string;
  amountCentavos: number;
  errorReason: string | null;
  billingUrl: string;
};

export function renderPaymentFailedEmail(input: RenderPaymentFailedInput): RenderedEmail {
  const { consultoraName, amountCentavos, errorReason, billingUrl } = input;
  const safeName = escapeHtml(consultoraName);
  const safeAmount = escapeHtml(formatARS(amountCentavos));
  const safeReason = errorReason ? escapeHtml(errorReason) : null;

  const subject = '[ConsultoraDemo] No pudimos procesar tu pago';
  const preheader = 'No pudimos cobrar tu cuota — actualizá tu método de pago';

  const reasonRow = safeReason
    ? `<tr>
                  <td style="padding: 4px 16px 16px 16px; font-size: 14px; line-height: 1.55; color: #71717a;">
                    <strong style="font-weight: 600; color: #18181b;">Motivo:</strong> ${safeReason}
                  </td>
                </tr>`
    : '';

  const bodyHtml = `
              <p style="margin: 0 0 16px 0;">Hola ${safeName},</p>
              <p style="margin: 0 0 16px 0;">
                Mercado Pago no pudo procesar el cobro de tu suscripción a ConsultoraDemo.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0; background-color: #fef2f2; border-radius: 6px; border: 1px solid #fecaca;">
                <tr>
                  <td style="padding: 16px; font-size: 15px; line-height: 1.55; color: #18181b;">
                    <strong style="font-weight: 600;">Monto:</strong> ${safeAmount}
                  </td>
                </tr>
                ${reasonRow}
              </table>
              <p style="margin: 0 0 16px 0;">
                Mercado Pago va a reintentar el cobro automáticamente en los próximos días. Para evitar perder acceso, te recomendamos verificar o actualizar tu método de pago desde el panel de facturación.
              </p>`;

  const html = renderDunningLayout({
    preheader,
    bodyHtml,
    ctaText: 'Revisar mi facturación',
    ctaUrl: billingUrl,
  });

  const reasonText = errorReason ? `Motivo: ${errorReason}` : null;

  const text = [
    `Hola ${consultoraName},`,
    '',
    'Mercado Pago no pudo procesar el cobro de tu suscripción a ConsultoraDemo.',
    '',
    `Monto: ${formatARS(amountCentavos)}`,
    ...(reasonText ? [reasonText] : []),
    '',
    'Mercado Pago va a reintentar el cobro automáticamente en los próximos días.',
    'Para evitar perder acceso, verificá o actualizá tu método de pago:',
    billingUrl,
    '',
    '---',
    'ConsultoraDemo · Hecho en Argentina',
  ].join('\n');

  return { subject, html, text };
}
