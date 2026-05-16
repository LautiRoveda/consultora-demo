/**
 * T-033 · Tests del template MarkdownV2 para reminder Telegram.
 *
 * Cobertura:
 *  - Render happy path con todos los campos.
 *  - Escape correcto de titulo con chars reservados (*, _, etc).
 *  - Escape de fecha con guiones.
 *  - Branch HOY vence (offset_days = 0).
 *  - Branch Vencido (fecha en pasado vs todayIso).
 *  - Branch Vence en N dias.
 *  - Deep-link bien formado con event.id UUID.
 *  - parseMode siempre 'MarkdownV2'.
 *  - Tipo desconocido cae a label "Vencimiento".
 */
import type { ReminderWithEvent } from '@/shared/notifications/types';
import { describe, expect, it } from 'vitest';

import { renderTelegramReminder } from '@/shared/telegram/message-templates/reminder-vencimiento';

function makeReminder(overrides?: {
  offset_days?: number;
  fecha_vencimiento?: string;
  titulo?: string;
  tipo?: string;
}): ReminderWithEvent {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    offset_days: overrides?.offset_days ?? 7,
    event: {
      id: '22222222-2222-2222-2222-222222222222',
      titulo: overrides?.titulo ?? 'Protocolo de ruido vence',
      tipo: overrides?.tipo ?? 'protocolo_anual',
      fecha_vencimiento: overrides?.fecha_vencimiento ?? '2026-06-15',
      descripcion: null,
      status: 'pending',
      recurrence_months: null,
      created_by: null,
      consultora_id: '33333333-3333-3333-3333-333333333333',
    },
  };
}

describe('renderTelegramReminder', () => {
  it('happy path: titulo simple + offset 7d + fecha futura', () => {
    const result = renderTelegramReminder({
      reminder: makeReminder(),
      todayIso: '2026-06-08',
    });

    expect(result.parseMode).toBe('MarkdownV2');
    expect(result.text).toBe(
      '*Protocolo de ruido vence*\n' +
        '\n' +
        'Protocolo anual: Vence en 7 días\n' +
        'Fecha: 15\\-06\\-2026\n' +
        '\n' +
        '[Ver en ConsultoraDemo](https://consultora-demo.test-ia.cloud/calendario/agenda?event=22222222-2222-2222-2222-222222222222)',
    );
    expect(result.deepLink).toBe(
      'https://consultora-demo.test-ia.cloud/calendario/agenda?event=22222222-2222-2222-2222-222222222222',
    );
  });

  it('escapa titulo con caracteres MarkdownV2 reservados', () => {
    const result = renderTelegramReminder({
      reminder: makeReminder({ titulo: 'EPP_2026 - Estación *Norte* (Línea #3)' }),
      todayIso: '2026-06-08',
    });
    // El bold * envuelve el titulo escapado.
    expect(result.text).toContain('*EPP\\_2026 \\- Estación \\*Norte\\* \\(Línea \\#3\\)*');
  });

  it('branch HOY vence cuando offset_days = 0', () => {
    const result = renderTelegramReminder({
      reminder: makeReminder({ offset_days: 0, fecha_vencimiento: '2026-06-15' }),
      todayIso: '2026-06-15',
    });
    expect(result.text).toContain('HOY vence');
    expect(result.text).not.toContain('Vence en');
  });

  it('branch Vencido cuando fecha < today (offset > 0 pero el reminder se procesa tarde)', () => {
    const result = renderTelegramReminder({
      reminder: makeReminder({ offset_days: 7, fecha_vencimiento: '2026-06-01' }),
      todayIso: '2026-06-10', // 9 dias post-vencimiento
    });
    expect(result.text).toContain('Vencido');
    expect(result.text).not.toContain('Vence en');
  });

  it('branch Vence en N días cuando fecha > today', () => {
    const result = renderTelegramReminder({
      reminder: makeReminder({ offset_days: 30, fecha_vencimiento: '2026-07-15' }),
      todayIso: '2026-06-15',
    });
    expect(result.text).toContain('Vence en 30 días');
  });

  it('tipo desconocido cae al label genérico "Vencimiento"', () => {
    // Cast intencional: emulamos un tipo no listado en TIPO_LABELS (ej drift de schema).
    const reminder = makeReminder({ tipo: 'foo_bar_baz' as unknown as string });
    const result = renderTelegramReminder({
      reminder,
      todayIso: '2026-06-08',
    });
    expect(result.text).toContain('Vencimiento:');
  });

  it('tipos epp_entrega, capacitacion, calibracion, examen_medico, rgrl_anual, custom', () => {
    const tipos: Array<[string, string]> = [
      ['epp_entrega', 'Entrega de EPP'],
      ['capacitacion', 'Capacitación'],
      ['calibracion', 'Calibración'],
      ['examen_medico', 'Examen médico'],
      ['rgrl_anual', 'RGRL anual'],
      ['custom', 'Vencimiento'],
    ];
    for (const [tipo, expectedLabel] of tipos) {
      const result = renderTelegramReminder({
        reminder: makeReminder({ tipo }),
        todayIso: '2026-06-08',
      });
      // El label se escapa, por lo que verificamos sin acentos en patrón:
      const safeLabel = expectedLabel.replace(/\./g, '\\.');
      expect(result.text).toContain(safeLabel);
    }
  });

  it('deep-link siempre apunta a /calendario/agenda?event=<id> con UUID exacto', () => {
    const result = renderTelegramReminder({
      reminder: makeReminder(),
      todayIso: '2026-06-08',
    });
    expect(result.deepLink).toMatch(
      /^https:\/\/consultora-demo\.test-ia\.cloud\/calendario\/agenda\?event=[0-9a-f-]{36}$/,
    );
  });

  it('default todayIso = hoy (no rompe si el caller no lo provee)', () => {
    const result = renderTelegramReminder({
      reminder: makeReminder({ offset_days: 30, fecha_vencimiento: '2099-12-31' }),
    });
    // Fecha lejana garantiza branch "Vence en N días" sin importar hoy real.
    expect(result.text).toContain('Vence en 30 días');
  });
});
