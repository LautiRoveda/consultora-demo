import type { RenderedEmail } from './_utils';

import { escapeHtml, renderDunningLayout } from './_utils';

/**
 * T-074 · Email dunning: trial vence en N dias (3 o 1).
 *
 * Templating con daysLeft variable. Patron T-031 (inline HTML + table-based).
 */

export type RenderTrialExpiresInput = {
  consultoraName: string;
  daysLeft: 3 | 1;
  billingUrl: string;
};

export function renderTrialExpiresEmail(input: RenderTrialExpiresInput): RenderedEmail {
  const { consultoraName, daysLeft, billingUrl } = input;
  const safeName = escapeHtml(consultoraName);

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
                Activá tu suscripción Pro (USD 30/mes) ahora para no perder continuidad. Podés cancelar cuando quieras.
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
    'Activá tu suscripción Pro (USD 30/mes) para no perder continuidad. Podés cancelar cuando quieras.',
    '',
    billingUrl,
    '',
    '---',
    'ConsultoraDemo · Hecho en Argentina',
  ].join('\n');

  return { subject, html, text };
}
