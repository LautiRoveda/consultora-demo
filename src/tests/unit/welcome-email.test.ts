import { describe, expect, it } from 'vitest';

import { renderWelcomeEmail } from '@/shared/notifications/email-templates/welcome';

const INFORMES_URL = 'https://consultora-demo.test-ia.cloud/informes/nuevo';
const EPP_URL = 'https://consultora-demo.test-ia.cloud/epp/entregas/nueva';

describe('renderWelcomeEmail', () => {
  it('inputs válidos → subject/html/text no vacíos', () => {
    const { subject, html, text } = renderWelcomeEmail({
      consultoraName: 'Acme HyS',
      trialDays: 14,
      informesUrl: INFORMES_URL,
      eppUrl: EPP_URL,
    });
    expect(subject).toBe('Bienvenido a ConsultoraDemo · Empezá tu trial de 14 días');
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it('html contiene ambas URLs (informe + EPP)', () => {
    const { html } = renderWelcomeEmail({
      consultoraName: 'Acme HyS',
      trialDays: 14,
      informesUrl: INFORMES_URL,
      eppUrl: EPP_URL,
    });
    expect(html).toContain(INFORMES_URL);
    expect(html).toContain(EPP_URL);
  });

  it('text plano contiene ambas URLs + saludo, sin tags HTML', () => {
    const { text } = renderWelcomeEmail({
      consultoraName: 'Acme HyS',
      trialDays: 14,
      informesUrl: INFORMES_URL,
      eppUrl: EPP_URL,
    });
    expect(text).toContain('Hola Acme HyS,');
    expect(text).toContain(INFORMES_URL);
    expect(text).toContain(EPP_URL);
    expect(text).not.toContain('<a href');
    expect(text).not.toContain('<table');
  });

  it('escapa el nombre de consultora con caracteres especiales', () => {
    const { html } = renderWelcomeEmail({
      consultoraName: '<Pérez & Asoc>',
      trialDays: 14,
      informesUrl: INFORMES_URL,
      eppUrl: EPP_URL,
    });
    expect(html).toContain('Hola &lt;Pérez &amp; Asoc&gt;');
    expect(html).not.toContain('Hola <Pérez & Asoc>');
  });

  it('refleja trialDays variable en subject', () => {
    const { subject } = renderWelcomeEmail({
      consultoraName: 'Acme HyS',
      trialDays: 7,
      informesUrl: INFORMES_URL,
      eppUrl: EPP_URL,
    });
    expect(subject).toContain('trial de 7 días');
  });

  it('estructura: header ConsultoraDemo + preheader oculto', () => {
    const { html } = renderWelcomeEmail({
      consultoraName: 'Acme HyS',
      trialDays: 14,
      informesUrl: INFORMES_URL,
      eppUrl: EPP_URL,
    });
    expect(html).toContain('ConsultoraDemo');
    expect(html).toContain('display: none');
    expect(html).toContain('Tu prueba gratis arrancó');
  });
});
