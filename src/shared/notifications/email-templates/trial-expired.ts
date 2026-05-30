import type { RenderedEmail } from './_utils';

import { formatARSMonthly } from '@/shared/lib/format-ars';

import { escapeHtml, formatFechaCorta, renderDunningLayout } from './_utils';

/**
 * T-074 · Email dunning: trial expirado.
 *
 * Disparado post-vencimiento por cron daily. Incluye fecha retencion datos
 * para tranquilizar al user que sus datos no se borran inmediatamente.
 *
 * T-108: el caller pasa `priceCentavos` (`Number(env.ARS_PRICE_MONTHLY)`)
 * para reemplazar el "USD 30/mes" hardcoded por display ARS sincronizado con
 * el cobro real en MP.
 */

export type RenderTrialExpiredInput = {
  consultoraName: string;
  billingUrl: string;
  retentionDate: string | null;
  priceCentavos: number;
};

export function renderTrialExpiredEmail(input: RenderTrialExpiredInput): RenderedEmail {
  const { consultoraName, billingUrl, retentionDate, priceCentavos } = input;
  const safeName = escapeHtml(consultoraName);
  const safeRetention = formatFechaCorta(retentionDate);
  const priceDisplay = formatARSMonthly(priceCentavos);

  const subject = '[ConsultoraDemo] Tu trial ha expirado';
  const preheader = 'Tu trial expiró — reactivá tu cuenta para retomar el acceso';

  const retentionLine = safeRetention
    ? `<p style="margin: 0 0 16px 0;">Tus datos quedan guardados hasta el <strong>${safeRetention}</strong>. Después de esa fecha podrían eliminarse permanentemente.</p>`
    : '<p style="margin: 0 0 16px 0;">Tus datos quedan guardados temporalmente. Reactivá tu cuenta para retomar el acceso completo.</p>';

  const bodyHtml = `
              <p style="margin: 0 0 16px 0;">Hola ${safeName},</p>
              <p style="margin: 0 0 16px 0;">
                Tu trial gratuito de ConsultoraDemo expiró. Por ahora ya no podés acceder a la app para crear informes o gestionar el calendario.
              </p>
              ${retentionLine}
              <p style="margin: 0 0 16px 0;">
                Activá tu suscripción Pro (${priceDisplay}) y volvés a tener acceso inmediato.
              </p>`;

  const html = renderDunningLayout({
    preheader,
    bodyHtml,
    ctaText: 'Reactivar mi cuenta',
    ctaUrl: billingUrl,
  });

  const retentionTextLine = safeRetention
    ? `Tus datos quedan guardados hasta el ${safeRetention}. Después de esa fecha podrían eliminarse permanentemente.`
    : 'Tus datos quedan guardados temporalmente. Reactivá tu cuenta para retomar acceso completo.';

  const text = [
    `Hola ${consultoraName},`,
    '',
    'Tu trial gratuito de ConsultoraDemo expiró.',
    'Por ahora ya no podés acceder a la app para crear informes o gestionar el calendario.',
    '',
    retentionTextLine,
    '',
    `Activá tu suscripción Pro (${priceDisplay}) y volvés a tener acceso inmediato:`,
    billingUrl,
    '',
    '---',
    'ConsultoraDemo · Hecho en Argentina',
  ].join('\n');

  return { subject, html, text };
}
