/**
 * T-074 · Unit tests de los 4 email templates dunning.
 *
 * Cubre:
 * - Subject correcto por template (incluye [ConsultoraDemo] + tema).
 * - HTML contiene nombre, datos clave, CTA, footer billing.
 * - XSS escape: caracteres especiales en consultoraName + errorReason.
 * - Text fallback plain readable.
 * - Format: formatARS centavos -> "$" es-AR, formatFechaCorta ISO -> DD/MM/YYYY.
 */
import { describe, expect, it } from 'vitest';

import {
  escapeHtml,
  formatARS,
  formatFechaCorta,
} from '@/shared/notifications/email-templates/_utils';
import { renderPaymentFailedEmail } from '@/shared/notifications/email-templates/payment-failed';
import { renderSubscriptionCancelledEmail } from '@/shared/notifications/email-templates/subscription-cancelled';
import { renderTrialExpiredEmail } from '@/shared/notifications/email-templates/trial-expired';
import { renderTrialExpiresEmail } from '@/shared/notifications/email-templates/trial-expires';

const BILLING_URL = 'https://consultora-demo.test-ia.cloud/settings/billing';

describe('_utils · formatARS', () => {
  it('1. formatea centavos como "$" es-AR con 2 decimales', () => {
    const out = formatARS(3_000_000); // 30.000,00 ARS
    expect(out).toContain('30.000,00');
    expect(out).toMatch(/\$/);
  });

  it('2. formatARS 0 centavos -> $0,00', () => {
    const out = formatARS(0);
    expect(out).toContain('0,00');
  });

  it('3. formatARS con decimales -> redondea bien', () => {
    const out = formatARS(12345); // 123,45 ARS
    expect(out).toContain('123,45');
  });
});

describe('_utils · formatFechaCorta', () => {
  it('4. ISO timestamptz -> DD/MM/YYYY', () => {
    expect(formatFechaCorta('2026-08-15T12:00:00Z')).toBe('15/08/2026');
  });

  it('5. ISO timestamptz mediodía UTC -> DD/MM/YYYY en TZ AR', () => {
    // T-085: formatFechaCorta ahora aplica TZ AR (era UTC directo).
    // UTC 14:00 = AR 11:00 → mismo día sin cross.
    expect(formatFechaCorta('2026-01-05T14:00:00.000Z')).toBe('05/01/2026');
  });

  it('5b. ISO UTC 00:00 cae en día anterior AR (verifica TZ aplicada)', () => {
    // UTC 00:00 = AR 21:00 del día anterior.
    expect(formatFechaCorta('2026-01-05T00:00:00.000Z')).toBe('04/01/2026');
  });

  it('6. null input -> null', () => {
    expect(formatFechaCorta(null)).toBeNull();
  });

  it('7. invalid string -> null', () => {
    expect(formatFechaCorta('not-a-date')).toBeNull();
  });
});

describe('_utils · escapeHtml', () => {
  it('8. escapa <, >, ", &, \'', () => {
    const out = escapeHtml(`<script>alert("xss")</script>&'`);
    expect(out).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;&#39;');
  });
});

// T-108: 3_000_000 centavos = ARS 30.000/mes (price display in dunning emails
// post-bump USD→ARS, sincronizado con currency_id='ARS' del preapproval MP).
const PRICE_CENTAVOS = 3_000_000;

describe('renderTrialExpiresEmail', () => {
  it('9. daysLeft=3 -> subject "vence en 3 días"', () => {
    const { subject } = renderTrialExpiresEmail({
      consultoraName: 'Acme HyS',
      daysLeft: 3,
      billingUrl: BILLING_URL,
      priceCentavos: PRICE_CENTAVOS,
    });
    expect(subject).toBe('[ConsultoraDemo] Tu trial vence en 3 días');
  });

  it('10. daysLeft=1 -> subject usa "día" singular', () => {
    const { subject } = renderTrialExpiresEmail({
      consultoraName: 'Acme HyS',
      daysLeft: 1,
      billingUrl: BILLING_URL,
      priceCentavos: PRICE_CENTAVOS,
    });
    expect(subject).toBe('[ConsultoraDemo] Tu trial vence en 1 día');
  });

  it('11. daysLeft=1 -> body usa "mañana" en rojo de urgencia', () => {
    const { html } = renderTrialExpiresEmail({
      consultoraName: 'Acme HyS',
      daysLeft: 1,
      billingUrl: BILLING_URL,
      priceCentavos: PRICE_CENTAVOS,
    });
    expect(html).toContain('mañana');
    expect(html).toContain('#b91c1c');
  });

  it('12. html contiene nombre escapado + CTA billing', () => {
    const { html } = renderTrialExpiresEmail({
      consultoraName: 'Acme <HyS>',
      daysLeft: 3,
      billingUrl: BILLING_URL,
      priceCentavos: PRICE_CENTAVOS,
    });
    expect(html).toContain('Hola Acme &lt;HyS&gt;');
    expect(html).toContain(BILLING_URL);
    expect(html).toContain('Activar mi suscripción');
  });

  it('13. text plain contiene CTA + saludo + sin tags HTML', () => {
    const { text } = renderTrialExpiresEmail({
      consultoraName: 'Acme HyS',
      daysLeft: 3,
      billingUrl: BILLING_URL,
      priceCentavos: PRICE_CENTAVOS,
    });
    expect(text).toContain('Hola Acme HyS,');
    expect(text).toContain(BILLING_URL);
    expect(text).not.toContain('<table');
    expect(text).not.toContain('<a href');
  });

  it('13b (T-108). html y text muestran precio ARS y NO mencionan USD', () => {
    const { html, text } = renderTrialExpiresEmail({
      consultoraName: 'Acme HyS',
      daysLeft: 3,
      billingUrl: BILLING_URL,
      priceCentavos: PRICE_CENTAVOS,
    });
    expect(html).toContain('ARS 30.000/mes');
    expect(text).toContain('ARS 30.000/mes');
    expect(html).not.toContain('USD');
    expect(text).not.toContain('USD');
  });
});

describe('renderTrialExpiredEmail', () => {
  it('14. subject -> "Tu trial ha expirado"', () => {
    const { subject } = renderTrialExpiredEmail({
      consultoraName: 'Acme',
      billingUrl: BILLING_URL,
      retentionDate: '2026-06-30T14:00:00Z',
      priceCentavos: PRICE_CENTAVOS,
    });
    expect(subject).toBe('[ConsultoraDemo] Tu trial ha expirado');
  });

  it('15. retentionDate presente -> aparece formateado en body', () => {
    const { html } = renderTrialExpiredEmail({
      consultoraName: 'Acme',
      billingUrl: BILLING_URL,
      retentionDate: '2026-06-30T14:00:00Z',
      priceCentavos: PRICE_CENTAVOS,
    });
    expect(html).toContain('30/06/2026');
  });

  it('16. retentionDate null -> body usa mensaje genérico', () => {
    const { html } = renderTrialExpiredEmail({
      consultoraName: 'Acme',
      billingUrl: BILLING_URL,
      retentionDate: null,
      priceCentavos: PRICE_CENTAVOS,
    });
    expect(html).not.toContain('hasta el');
    expect(html).toContain('Tus datos quedan guardados');
  });

  it('17. consultoraName con XSS -> escapado', () => {
    const { html } = renderTrialExpiredEmail({
      consultoraName: '<img src=x onerror=alert(1)>',
      billingUrl: BILLING_URL,
      retentionDate: null,
      priceCentavos: PRICE_CENTAVOS,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('17b (T-108). html y text muestran precio ARS y NO mencionan USD', () => {
    const { html, text } = renderTrialExpiredEmail({
      consultoraName: 'Acme',
      billingUrl: BILLING_URL,
      retentionDate: null,
      priceCentavos: PRICE_CENTAVOS,
    });
    expect(html).toContain('ARS 30.000/mes');
    expect(text).toContain('ARS 30.000/mes');
    expect(html).not.toContain('USD');
    expect(text).not.toContain('USD');
  });
});

describe('renderPaymentFailedEmail', () => {
  it('18. subject -> "No pudimos procesar tu pago"', () => {
    const { subject } = renderPaymentFailedEmail({
      consultoraName: 'Acme',
      amountCentavos: 3_000_000,
      errorReason: 'cc_rejected_insufficient_amount',
      billingUrl: BILLING_URL,
    });
    expect(subject).toBe('[ConsultoraDemo] No pudimos procesar tu pago');
  });

  it('19. amountCentavos formateado en ARS aparece en body', () => {
    const { html } = renderPaymentFailedEmail({
      consultoraName: 'Acme',
      amountCentavos: 3_000_000,
      errorReason: null,
      billingUrl: BILLING_URL,
    });
    expect(html).toContain('30.000,00');
  });

  it('20. errorReason presente -> aparece escapado en body', () => {
    const { html } = renderPaymentFailedEmail({
      consultoraName: 'Acme',
      amountCentavos: 100,
      errorReason: 'cc_rejected_high_risk',
      billingUrl: BILLING_URL,
    });
    expect(html).toContain('cc_rejected_high_risk');
    expect(html).toContain('Motivo:');
  });

  it('21. errorReason null -> NO aparece "Motivo:" en body', () => {
    const { html } = renderPaymentFailedEmail({
      consultoraName: 'Acme',
      amountCentavos: 100,
      errorReason: null,
      billingUrl: BILLING_URL,
    });
    expect(html).not.toContain('Motivo:');
  });

  it('22. CTA dirige a billingUrl', () => {
    const { html } = renderPaymentFailedEmail({
      consultoraName: 'Acme',
      amountCentavos: 100,
      errorReason: null,
      billingUrl: BILLING_URL,
    });
    expect(html).toContain(BILLING_URL);
    expect(html).toContain('Revisar mi facturación');
  });
});

describe('renderSubscriptionCancelledEmail', () => {
  it('23. subject -> "Tu suscripción fue cancelada"', () => {
    const { subject } = renderSubscriptionCancelledEmail({
      consultoraName: 'Acme',
      activeUntil: '2026-07-15T14:00:00Z',
      billingUrl: BILLING_URL,
    });
    expect(subject).toBe('[ConsultoraDemo] Tu suscripción fue cancelada');
  });

  it('24. activeUntil presente -> fecha formateada en body', () => {
    const { html } = renderSubscriptionCancelledEmail({
      consultoraName: 'Acme',
      activeUntil: '2026-07-15T14:00:00Z',
      billingUrl: BILLING_URL,
    });
    expect(html).toContain('15/07/2026');
    expect(html).toContain('sigue activo hasta');
  });

  it('25. activeUntil null -> mensaje generico sin fecha', () => {
    const { html } = renderSubscriptionCancelledEmail({
      consultoraName: 'Acme',
      activeUntil: null,
      billingUrl: BILLING_URL,
    });
    expect(html).not.toContain('sigue activo hasta');
    expect(html).toContain('ya no será renovado');
  });

  it('26. text contiene CTA + reactivar copy', () => {
    const { text } = renderSubscriptionCancelledEmail({
      consultoraName: 'Acme',
      activeUntil: '2026-07-15T14:00:00Z',
      billingUrl: BILLING_URL,
    });
    expect(text).toContain('reactivar tu plan');
    expect(text).toContain(BILLING_URL);
  });
});

describe('all dunning templates · layout estructural', () => {
  it('27. todos los templates contienen header ConsultoraDemo + footer billing link', () => {
    const renders = [
      renderTrialExpiresEmail({
        consultoraName: 'X',
        daysLeft: 3,
        billingUrl: BILLING_URL,
        priceCentavos: PRICE_CENTAVOS,
      }),
      renderTrialExpiredEmail({
        consultoraName: 'X',
        billingUrl: BILLING_URL,
        retentionDate: null,
        priceCentavos: PRICE_CENTAVOS,
      }),
      renderPaymentFailedEmail({
        consultoraName: 'X',
        amountCentavos: 100,
        errorReason: null,
        billingUrl: BILLING_URL,
      }),
      renderSubscriptionCancelledEmail({
        consultoraName: 'X',
        activeUntil: null,
        billingUrl: BILLING_URL,
      }),
    ];
    for (const { html } of renders) {
      expect(html).toContain('ConsultoraDemo');
      expect(html).toContain('Gestioná tu plan y facturación');
      expect(html).toContain('display: none'); // preheader hidden
      expect(html).toContain('mso-hide: all');
    }
  });
});
