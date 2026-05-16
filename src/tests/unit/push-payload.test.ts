/**
 * T-034 · Tests unit del render de Push payload.
 */
import type { ReminderWithEvent } from '@/shared/notifications/types';
import { describe, expect, it } from 'vitest';

import { renderPushPayload } from '@/shared/push/payload';

function makeReminder(overrides?: {
  offset_days?: number;
  fecha?: string;
  tipo?: string;
  titulo?: string;
  eventId?: string;
}): ReminderWithEvent {
  return {
    id: 'rem-id-1',
    offset_days: overrides?.offset_days ?? 7,
    event: {
      id: overrides?.eventId ?? 'event-uuid-1',
      titulo: overrides?.titulo ?? 'Protocolo de ruido planta Olivos',
      tipo: overrides?.tipo ?? 'protocolo_anual',
      fecha_vencimiento: overrides?.fecha ?? '2026-06-15',
      descripcion: null,
      status: 'pending',
      recurrence_months: 12,
      created_by: 'user-id',
      consultora_id: 'consultora-id',
    },
  };
}

describe('renderPushPayload', () => {
  it('1. happy path offset_days > 0 future: body "Vence en N días"', () => {
    const reminder = makeReminder({ offset_days: 30, fecha: '2026-06-15' });
    const payload = renderPushPayload({
      reminder,
      deepLink: 'https://app.test/calendario/agenda?event=event-uuid-1',
      todayIso: '2026-05-16',
    });

    expect(payload.title).toBe('ConsultoraDemo · Protocolo anual');
    expect(payload.body).toBe('Vence en 30 días: Protocolo de ruido planta Olivos');
    expect(payload.url).toBe('https://app.test/calendario/agenda?event=event-uuid-1');
    expect(payload.tag).toBe('event-event-uuid-1');
    expect(payload.icon).toBe('/favicon.ico');
  });

  it('2. offset_days === 0 + fecha === today: body "HOY vence"', () => {
    const reminder = makeReminder({ offset_days: 0, fecha: '2026-05-16' });
    const payload = renderPushPayload({
      reminder,
      deepLink: 'https://app.test/',
      todayIso: '2026-05-16',
    });
    expect(payload.body).toBe('HOY vence: Protocolo de ruido planta Olivos');
  });

  it('3. fecha < today: body "Vencido" (defensa por si reminder se procesa post-fecha)', () => {
    const reminder = makeReminder({ offset_days: 0, fecha: '2026-05-10' });
    const payload = renderPushPayload({
      reminder,
      deepLink: 'https://app.test/',
      todayIso: '2026-05-16',
    });
    expect(payload.body).toBe('Vencido: Protocolo de ruido planta Olivos');
  });

  it('4. tipo desconocido fallback "Vencimiento"', () => {
    const reminder = makeReminder({ tipo: 'tipo_inexistente' });
    const payload = renderPushPayload({
      reminder,
      deepLink: 'https://app.test/',
      todayIso: '2026-05-16',
    });
    expect(payload.title).toBe('ConsultoraDemo · Vencimiento');
  });

  it('5. cada tipo conocido produce label es-AR', () => {
    const tipos = [
      ['protocolo_anual', 'Protocolo anual'],
      ['rgrl_anual', 'RGRL anual'],
      ['capacitacion', 'Capacitación'],
      ['calibracion', 'Calibración'],
      ['examen_medico', 'Examen médico'],
      ['epp_entrega', 'EPP — entrega'],
      ['custom', 'Vencimiento'],
    ];
    for (const [tipo, label] of tipos) {
      const r = makeReminder({ tipo: tipo! });
      const p = renderPushPayload({ reminder: r, deepLink: 'x', todayIso: '2026-05-16' });
      expect(p.title).toBe(`ConsultoraDemo · ${label}`);
    }
  });

  it('6. tag derivado de eventId — reminders del mismo event apilan/reemplazan', () => {
    const r1 = makeReminder({ offset_days: 30, eventId: 'evt-xyz' });
    const r2 = makeReminder({ offset_days: 7, eventId: 'evt-xyz' });
    const p1 = renderPushPayload({ reminder: r1, deepLink: 'x', todayIso: '2026-05-16' });
    const p2 = renderPushPayload({ reminder: r2, deepLink: 'x', todayIso: '2026-05-16' });
    expect(p1.tag).toBe('event-evt-xyz');
    expect(p2.tag).toBe('event-evt-xyz');
    expect(p1.tag).toBe(p2.tag);
  });

  it('7. deepLink se propaga literal sin transformaciones', () => {
    const reminder = makeReminder();
    const deepLink = 'https://prod.com/calendario/agenda?event=abc&utm=ignored';
    const payload = renderPushPayload({ reminder, deepLink, todayIso: '2026-05-16' });
    expect(payload.url).toBe(deepLink);
  });

  it('8. titulo absurdo no rompe el render (sin truncate aquí — sender hace la defensa)', () => {
    const longTitle = 'A'.repeat(3000);
    const reminder = makeReminder({ titulo: longTitle });
    const payload = renderPushPayload({
      reminder,
      deepLink: 'x',
      todayIso: '2026-05-16',
    });
    expect(payload.body).toContain(longTitle);
    // El sender es el que defiende 4KB del Push Service — payload.ts solo arma el shape.
  });

  it('9. todayIso default es hoy del runtime (no hardcoded)', () => {
    const reminder = makeReminder({ offset_days: 7, fecha: '2030-01-01' });
    const payload = renderPushPayload({
      reminder,
      deepLink: 'x',
      // todayIso omitido → usa Date.now()
    });
    // Como fecha es 2030 y hoy es bastante antes, debería ser "Vence en N días".
    expect(payload.body).toMatch(/Vence en \d+ días: Protocolo/);
  });
});
