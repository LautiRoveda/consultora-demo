import type { RenderedEmail } from './_utils';

import { formatARSMonthly } from '@/shared/lib/format-ars';

import { escapeHtml, renderDunningLayout } from './_utils';

/**
 * T-074 · Email dunning: trial vence en N dias (3 o 1).
 *
 * Templating con daysLeft variable. Patron T-031 (inline HTML + table-based).
 *
 * T-108: el caller pasa `priceCentavos` (`Number(env.ARS_PRICE_MONTHLY)`)
 * para reemplazar el "USD 30/mes" hardcoded por display ARS sincronizado con
 * el cobro real en MP (currency_id='ARS' en preapproval, ver
 * `src/shared/mercadopago/client.ts`).
 */

export type RenderTrialExpiresInput = {
  consultoraName: string;
  daysLeft: 3 | 1;
  billingUrl: string;
  priceCentavos: number;
};

export function renderTrialExpiresEmail(input: RenderTrialExpiresInput): RenderedEmail {
  const { consultoraName, daysLeft, billingUrl, priceCentavos } = input;
  const safeName = escapeHtml(consultoraName);
  const priceDisplay = formatARSMonthly(priceCentavos);

  const dayWord = daysLeft === 1 ? 'día' : 'días';
  const subject = `[ConsultoraDemo] Tu trial vence en ${daysLeft} ${dayWord}`;
  const preheader = `Tu trial de ConsultoraDemo vence en ${daysLeft} ${dayWord}`;

  const urgencyText =
    daysLeft === 1
      ? 'Tu trial gratuito vence <strong style="color: #b91c1c;">mañana</strong>.'
      : `Tu trial gratuito vence en <strong>${daysLeft} días</strong>.`;

  const bodyHtml = `
              <p style="margin: 0 0 16px 0;">Hola ${safeName},</p>
              <p style="margin: 0 0 16px 0;">
                ${urgencyText} Una vez que se cumpla el plazo, perderás acceso a la app — pero tus datos quedan guardados.
              </p>
              <p style="margin: 0 0 16px 0;">
                Activá tu suscripción Pro (${priceDisplay}) ahora para no perder continuidad. Podés cancelar cuando quieras.
              </p>`;

  const html = renderDunningLayout({
    preheader,
    bodyHtml,
    ctaText: 'Activar mi suscripción',
    ctaUrl: billingUrl,
  });

  const text = [
    `Hola ${consultoraName},`,
    '',
    daysLeft === 1
      ? 'Tu trial gratuito de ConsultoraDemo vence MAÑANA.'
      : `Tu trial gratuito de ConsultoraDemo vence en ${daysLeft} días.`,
    'Una vez que se cumpla el plazo perdés acceso a la app, pero tus datos quedan guardados.',
    '',
    `Activá tu suscripción Pro (${priceDisplay}) para no perder continuidad. Podés cancelar cuando quieras.`,
    '',
    billingUrl,
    '',
    '---',
    'ConsultoraDemo · Hecho en Argentina',
  ].join('\n');

  return { subject, html, text };
}
