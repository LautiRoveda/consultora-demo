import type { RenderedEmail } from './_utils';

import { escapeHtml, renderDunningLayout } from './_utils';

/**
 * T-142 · Welcome email post-confirmación de signup.
 *
 * Sale desde el callback `/auth/callback?from=signup` (el usuario ya confirmó y
 * puede actuar). Refuerza el trial sin tarjeta y empuja al primer paso con dos
 * acciones: generar informe (CTA primario = botón del layout) y registrar EPP
 * (link de texto dentro del body). Reusa la estructura table-based de
 * `renderDunningLayout` (header + botón + footer estándar). El botón vive al pie
 * del body, así que el body presenta ambas acciones y el botón cierra con la
 * primaria (informe).
 */

export type RenderWelcomeEmailInput = {
  consultoraName: string;
  trialDays: number;
  informesUrl: string;
  eppUrl: string;
};

export function renderWelcomeEmail(input: RenderWelcomeEmailInput): RenderedEmail {
  const { consultoraName, trialDays, informesUrl, eppUrl } = input;
  const safeName = escapeHtml(consultoraName);

  const subject = `Bienvenido a ConsultoraDemo · Empezá tu trial de ${trialDays} días`;
  const preheader = 'Tu prueba gratis arrancó. Estas son las dos cosas que podés hacer hoy.';

  const bodyHtml = `
              <p style="margin: 0 0 16px 0;">Hola ${safeName},</p>
              <p style="margin: 0 0 16px 0;">
                Tu prueba gratis de <strong>${trialDays} días</strong> ya está activa — sin tarjeta, sin compromiso. Estas son las dos cosas que podés hacer hoy:
              </p>
              <p style="margin: 0 0 4px 0; font-size: 16px; font-weight: 600; color: #18181b;">
                1 · Generá tu primer informe
              </p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                En 5 minutos. La IA completa el borrador, vos revisás y firmás.
              </p>
              <p style="margin: 0 0 4px 0; font-size: 16px; font-weight: 600; color: #18181b;">
                2 · Registrá entregas de EPP
              </p>
              <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5;">
                <a href="${eppUrl}" style="color: #4f46e5; text-decoration: underline;">Registrá entregas de EPP</a>
                <span style="color: #71717a;"> — el sistema genera los vencimientos automáticamente y te avisamos antes que se cumplan.</span>
              </p>`;

  const html = renderDunningLayout({
    preheader,
    bodyHtml,
    ctaText: 'Generá tu primer informe',
    ctaUrl: informesUrl,
  });

  const text = [
    `Hola ${consultoraName},`,
    '',
    `Tu prueba gratis de ${trialDays} días ya está activa — sin tarjeta, sin compromiso.`,
    'Estas son las dos cosas que podés hacer hoy:',
    '',
    '1 · Generá tu primer informe (en 5 minutos; la IA completa el borrador, vos revisás y firmás):',
    informesUrl,
    '',
    '2 · Registrá entregas de EPP (los vencimientos se crean automáticamente y te avisamos antes que se cumplan):',
    eppUrl,
    '',
    '---',
    'ConsultoraDemo · Hecho en Argentina',
  ].join('\n');

  return { subject, html, text };
}
