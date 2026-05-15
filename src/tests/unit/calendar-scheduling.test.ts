/**
 * T-028 · Tests del helper de scheduling de calendar reminders.
 *
 * Cobertura:
 *  - computeScheduledAtUtc: offset UTC fijo (-3 ART), shift de dias correcto
 *    cross-mes, cross-anio, cross-DST-USA (irrelevante porque AR no tiene DST).
 *  - computeReminderRows: skip silencioso de reminders en pasado, contador
 *    skippedPast, rows ordenadas igual que el input.
 *  - addRecurrenceMonths: handle correcto fin-de-mes (Jan 31 + 1 = Feb 28/29,
 *    Mar 31 + 1 = Apr 30) + recurrence anual cross-bisiesto.
 */
import { describe, expect, it } from 'vitest';

import {
  addRecurrenceMonths,
  computeReminderRows,
  computeScheduledAtUtc,
} from '@/shared/calendar/scheduling';

describe('computeScheduledAtUtc', () => {
  it('caso base: vencimiento en agosto, offset 7d → 8 dias antes a 12:00 UTC', () => {
    const result = computeScheduledAtUtc('2026-08-15', 7);
    expect(result.toISOString()).toBe('2026-08-08T12:00:00.000Z');
  });

  it('offset 0 → mismo dia del vencimiento a 12:00 UTC (= 09:00 ART)', () => {
    const result = computeScheduledAtUtc('2026-08-15', 0);
    expect(result.toISOString()).toBe('2026-08-15T12:00:00.000Z');
  });

  it('cross-mes: vencimiento 5 de mes con offset 30 cae al mes anterior', () => {
    const result = computeScheduledAtUtc('2026-03-05', 30);
    expect(result.toISOString()).toBe('2026-02-03T12:00:00.000Z');
  });

  it('cross-anio: vencimiento 15-enero con offset 60 cae en noviembre del anio previo', () => {
    const result = computeScheduledAtUtc('2026-01-15', 60);
    expect(result.toISOString()).toBe('2025-11-16T12:00:00.000Z');
  });

  it('offset grande 365: cae exactamente un anio antes', () => {
    const result = computeScheduledAtUtc('2026-08-15', 365);
    expect(result.toISOString()).toBe('2025-08-15T12:00:00.000Z');
  });

  it('hora UTC siempre 12:00 (= 09:00 ART, sin importar TZ del runtime)', () => {
    const r1 = computeScheduledAtUtc('2026-12-25', 7);
    const r2 = computeScheduledAtUtc('2026-06-21', 14);
    expect(r1.getUTCHours()).toBe(12);
    expect(r2.getUTCHours()).toBe(12);
    expect(r1.getUTCMinutes()).toBe(0);
    expect(r2.getUTCMinutes()).toBe(0);
  });
});

describe('computeReminderRows', () => {
  const baseArgs = {
    eventId: '00000000-0000-4000-8000-000000000001',
    consultoraId: '00000000-0000-4000-8000-000000000002',
    fechaVencimientoIso: '2026-08-15',
  };

  it('happy path: todos futuros → todos los rows insertados', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const result = computeReminderRows({
      ...baseArgs,
      offsetDays: [60, 30, 7, 0],
      now,
    });
    expect(result.skippedPast).toBe(0);
    expect(result.rows.length).toBe(4);
    expect(result.rows[0]?.offset_days).toBe(60);
    expect(result.rows[3]?.offset_days).toBe(0);
    // scheduled_at correctos.
    expect(result.rows[0]?.scheduled_at).toBe('2026-06-16T12:00:00.000Z');
    expect(result.rows[3]?.scheduled_at).toBe('2026-08-15T12:00:00.000Z');
  });

  it('skip silencioso: offset cae en pasado → no se inserta + skippedPast incrementa', () => {
    // now = Aug 10, vencimiento = Aug 15 → offsets [30, 7, 0]:
    //  - 30 dias antes = Jul 16 → pasado, skip.
    //  - 7 dias antes = Aug 8 → pasado, skip.
    //  - 0 = Aug 15 12:00 UTC → futuro, insert.
    const now = new Date('2026-08-10T00:00:00.000Z');
    const result = computeReminderRows({
      ...baseArgs,
      offsetDays: [30, 7, 0],
      now,
    });
    expect(result.skippedPast).toBe(2);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.offset_days).toBe(0);
  });

  it('todos en pasado: 0 rows, skippedPast = N', () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const result = computeReminderRows({
      ...baseArgs,
      offsetDays: [30, 7, 0],
      now,
    });
    expect(result.rows.length).toBe(0);
    expect(result.skippedPast).toBe(3);
  });

  it('rows propagan event_id + consultora_id correctos', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const result = computeReminderRows({
      ...baseArgs,
      offsetDays: [7],
      now,
    });
    expect(result.rows[0]?.event_id).toBe(baseArgs.eventId);
    expect(result.rows[0]?.consultora_id).toBe(baseArgs.consultoraId);
  });

  it('preserva orden de offsets del input (no reordena)', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const result = computeReminderRows({
      ...baseArgs,
      offsetDays: [7, 60, 0, 30],
      now,
    });
    expect(result.rows.map((r) => r.offset_days)).toEqual([7, 60, 0, 30]);
  });
});

describe('addRecurrenceMonths', () => {
  it('caso base: 12 meses → mismo dia del anio siguiente', () => {
    expect(addRecurrenceMonths('2026-08-15', 12)).toBe('2027-08-15');
  });

  it('1 mes desde Jan 31 → Feb 28 (no Mar 3) — fix de Date nativo', () => {
    expect(addRecurrenceMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('1 mes desde Jan 31 a anio bisiesto → Feb 29', () => {
    // 2028 es bisiesto.
    expect(addRecurrenceMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('1 mes desde Mar 31 → Apr 30 (no May 1)', () => {
    expect(addRecurrenceMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('6 meses desde 15-jul → 15-ene del anio siguiente', () => {
    expect(addRecurrenceMonths('2026-07-15', 6)).toBe('2027-01-15');
  });

  it('60 meses (cap recurrencia) → 5 anios despues', () => {
    expect(addRecurrenceMonths('2026-08-15', 60)).toBe('2031-08-15');
  });
});
