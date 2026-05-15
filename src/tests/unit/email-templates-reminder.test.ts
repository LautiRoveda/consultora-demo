/**
 * T-031 · Unit tests del template HTML del email recordatorio.
 *
 * Cubre:
 * - Subject por offset (offset=0 -> HOY, offset>0 -> Vence en N días).
 * - HTML contiene titulo + fecha es-AR + link al evento + footer prefs.
 * - Text fallback es plain readable.
 * - XSS defense: caracteres especiales (< > " ' &) escapados.
 * - Footer unsubscribe presente en HTML + text.
 */
import type { ReminderWithEvent } from '@/shared/notifications/types';
import { describe, expect, it } from 'vitest';

import { renderReminderEmail } from '@/shared/notifications/email-templates/reminder-vencimiento';

function makeReminder(overrides: Partial<ReminderWithEvent> = {}): ReminderWithEvent {
  return {
    id: 'rem-uuid-1',
    offset_days: 7,
    event: {
      id: 'evt-uuid-1',
      titulo: 'RGRL Constructora del Sur',
      tipo: 'rgrl_anual',
      fecha_vencimiento: '2026-08-15',
      descripcion: null,
      status: 'pending',
      recurrence_months: 12,
      created_by: 'user-uuid-1',
      consultora_id: 'cons-uuid-1',
      ...overrides.event,
    },
    ...overrides,
  };
}

describe('renderReminderEmail · subject', () => {
  it('1. offset=0 -> subject empieza con "[ConsultoraDemo] HOY vence:"', () => {
    const { subject } = renderReminderEmail({
      reminder: makeReminder({ offset_days: 0 }),
      recipientName: 'Juan',
    });
    expect(subject).toBe('[ConsultoraDemo] HOY vence: RGRL Constructora del Sur');
  });

  it('2. offset=7 -> subject "Vence en 7 días: <titulo>"', () => {
    const { subject } = renderReminderEmail({
      reminder: makeReminder({ offset_days: 7 }),
      recipientName: null,
    });
    expect(subject).toBe('[ConsultoraDemo] Vence en 7 días: RGRL Constructora del Sur');
  });

  it('3. offset=30 -> N parameterizado', () => {
    const { subject } = renderReminderEmail({
      reminder: makeReminder({ offset_days: 30 }),
      recipientName: null,
    });
    expect(subject).toContain('Vence en 30 días');
  });
});

describe('renderReminderEmail · HTML', () => {
  it('4. HTML contiene titulo del evento', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder(),
      recipientName: null,
    });
    expect(html).toContain('RGRL Constructora del Sur');
  });

  it('5. HTML contiene fecha formateada en es-AR', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder({
        event: {
          ...makeReminder().event,
          fecha_vencimiento: '2026-08-15',
        },
      }),
      recipientName: null,
    });
    expect(html).toContain('15 de agosto de 2026');
  });

  it('6. HTML contiene link al evento con event.id', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder(),
      recipientName: null,
    });
    expect(html).toContain(
      'https://consultora-demo.test-ia.cloud/calendario/agenda?event=evt-uuid-1',
    );
  });

  it('7. HTML saluda con nombre si fue provisto', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder(),
      recipientName: 'Juan Pérez',
    });
    expect(html).toContain('Hola Juan Pérez,');
  });

  it('8. HTML saluda genérico si recipientName=null', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder(),
      recipientName: null,
    });
    expect(html).toContain('Hola,');
    expect(html).not.toContain('Hola null');
  });

  it('9. HTML incluye descripción si está presente', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder({
        event: {
          ...makeReminder().event,
          descripcion: 'Coordinar con Pablo del ART',
        },
      }),
      recipientName: null,
    });
    expect(html).toContain('Coordinar con Pablo del ART');
  });

  it('10. HTML NO incluye descripción si es null', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder({
        event: {
          ...makeReminder().event,
          descripcion: null,
        },
      }),
      recipientName: null,
    });
    expect(html).not.toContain('Detalle:');
  });

  it('11. HTML contiene footer con link a settings/notificaciones', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder(),
      recipientName: null,
    });
    expect(html).toContain('https://consultora-demo.test-ia.cloud/settings/notificaciones');
    expect(html).toContain('Modificá tus preferencias de notificaciones');
  });

  it('12. HTML contiene preheader con display:none + mso-hide:all', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder(),
      recipientName: null,
    });
    expect(html).toContain('display: none');
    expect(html).toContain('mso-hide: all');
  });
});

describe('renderReminderEmail · XSS defense', () => {
  it('13. titulo con < > escapado correctamente', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder({
        event: {
          ...makeReminder().event,
          titulo: '<script>alert(1)</script>Vencimiento',
        },
      }),
      recipientName: null,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('14. recipientName con caracteres especiales escapado', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder(),
      recipientName: '"><img src=x>',
    });
    expect(html).not.toContain('"><img src=x>');
    expect(html).toContain('&quot;&gt;&lt;img');
  });

  it('15. descripcion con & escapado', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder({
        event: {
          ...makeReminder().event,
          descripcion: 'ART & SRT',
        },
      }),
      recipientName: null,
    });
    expect(html).toContain('ART &amp; SRT');
  });
});

describe('renderReminderEmail · text fallback', () => {
  it('16. text es plain readable con titulo + fecha + link evento', () => {
    const { text } = renderReminderEmail({
      reminder: makeReminder(),
      recipientName: 'Juan',
    });
    expect(text).toContain('Hola Juan,');
    expect(text).toContain('RGRL Constructora del Sur');
    expect(text).toContain('15 de agosto de 2026');
    expect(text).toContain(
      'https://consultora-demo.test-ia.cloud/calendario/agenda?event=evt-uuid-1',
    );
  });

  it('17. text contiene footer unsubscribe con link a settings', () => {
    const { text } = renderReminderEmail({
      reminder: makeReminder(),
      recipientName: null,
    });
    expect(text).toContain('¿No querés recibir más estos avisos?');
    expect(text).toContain('https://consultora-demo.test-ia.cloud/settings/notificaciones');
  });

  it('18. text NO contiene tags HTML', () => {
    const { text } = renderReminderEmail({
      reminder: makeReminder({
        event: {
          ...makeReminder().event,
          titulo: 'Vencimiento normal',
          descripcion: 'Sin <b>bold</b>',
        },
      }),
      recipientName: null,
    });
    expect(text).not.toContain('<table');
    expect(text).not.toContain('<a href');
    expect(text).not.toContain('<p style');
  });
});

describe('renderReminderEmail · tipo labels es-AR', () => {
  it('19. tipo=protocolo_anual -> label "Protocolo anual"', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder({
        event: { ...makeReminder().event, tipo: 'protocolo_anual' },
      }),
      recipientName: null,
    });
    expect(html).toContain('Protocolo anual');
  });

  it('20. tipo=epp_entrega -> label "Entrega de EPP"', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder({
        event: { ...makeReminder().event, tipo: 'epp_entrega' },
      }),
      recipientName: null,
    });
    expect(html).toContain('Entrega de EPP');
  });

  it('21. tipo=custom -> label "Vencimiento" (fallback)', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder({
        event: { ...makeReminder().event, tipo: 'custom' },
      }),
      recipientName: null,
    });
    expect(html).toContain('Vencimiento');
  });

  it('22. tipo desconocido -> label "Vencimiento" (fallback)', () => {
    const { html } = renderReminderEmail({
      reminder: makeReminder({
        event: { ...makeReminder().event, tipo: 'tipo_inventado' },
      }),
      recipientName: null,
    });
    expect(html).toContain('Vencimiento');
  });
});
