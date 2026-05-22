import type { RenderedEmail } from './_utils';

import { escapeHtml, formatFechaCorta, renderDunningLayout } from './_utils';

/**
 * T-074 · Email dunning: suscripcion cancelada.
 *
 * Sync trigger desde webhook MP cuando estado=cancelada. Incluye fecha
 * hasta la que el plan sigue activo (cancelar_en) para evitar confusion
 * "ya no puedo entrar" inmediato.
 */

export type RenderSubscriptionCancelledInput = {
  consultoraName: string;
  activeUntil: string | null;
  billingUrl: string;
};

export function renderSubscriptionCancelledEmail(
  input: RenderSubscriptionCancelledInput,
): RenderedEmail {
  const { consultoraName, activeUntil, billingUrl } = input;
  const safeName = escapeHtml(consultoraName);
  const safeUntil = formatFechaCorta(activeUntil);

  const subject = '[ConsultoraDemo] Tu suscripción fue cancelada';
  const preheader = 'Confirmamos la cancelación de tu plan';

  const activeUntilLine = safeUntil
    ? `<p style="margin: 0 0 16px 0;">Tu plan sigue activo hasta el <strong>${safeUntil}</strong>. Hasta esa fecha podés seguir usando la app sin restricciones.</p>`
    : '<p style="margin: 0 0 16px 0;">Tu plan ya no será renovado en el próximo ciclo.</p>';

  const bodyHtml = `
              <p style="margin: 0 0 16px 0;">Hola ${safeName},</p>
              <p style="margin: 0 0 16px 0;">
                Confirmamos la cancelación de tu suscripción a ConsultoraDemo.
              </p>
              ${activeUntilLine}
              <p style="margin: 0 0 16px 0;">
                ¿Cambiaste de opinión? Podés reactivar tu plan cuando quieras desde el panel de facturación.
              </p>`;

  const html = renderDunningLayout({
    preheader,
    bodyHtml,
    ctaText: 'Reactivar mi plan',
    ctaUrl: billingUrl,
  });

  const activeUntilTextLine = safeUntil
    ? `Tu plan sigue activo hasta el ${safeUntil}. Hasta esa fecha podés usar la app sin restricciones.`
    : 'Tu plan ya no será renovado en el próximo ciclo.';

  const text = [
    `Hola ${consultoraName},`,
    '',
    'Confirmamos la cancelación de tu suscripción a ConsultoraDemo.',
    '',
    activeUntilTextLine,
    '',
    '¿Cambiaste de opinión? Podés reactivar tu plan cuando quieras:',
    billingUrl,
    '',
    '---',
    'ConsultoraDemo · Hecho en Argentina',
  ].join('\n');

  return { subject, html, text };
}
