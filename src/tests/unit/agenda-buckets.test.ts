/**
 * T-030 · Tests del helper agenda-buckets.
 *
 * Helper puro: testeamos rangos exactos de bordes (inclusive/exclusive), sort
 * intra-bucket, silent drop de non-pending, cross-year, bisiesto.
 */
import type { CalendarEventRow } from '@/app/(app)/calendario/queries';
import { describe, expect, it } from 'vitest';

import { addDaysIso, groupEventsByBucket } from '@/app/(app)/calendario/agenda-buckets';

function makeEvent(overrides: Partial<CalendarEventRow>): CalendarEventRow {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-000000000001',
    consultora_id: '00000000-0000-4000-8000-000000000aaa',
    tipo: 'custom',
    titulo: overrides.titulo ?? 'Test event',
    descripcion: null,
    informe_id: null,
    fecha_vencimiento: overrides.fecha_vencimiento ?? '2026-06-15',
    recurrence_months: null,
    status: overrides.status ?? 'pending',
    completed_at: null,
    completed_by: null,
    parent_event_id: null,
    reminder_offsets_days: [7, 0],
    metadata: null,
    created_by: '00000000-0000-4000-8000-000000000bbb',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

// `now` deterministico: 2026-06-15 12:00:00Z. Asi todayIso = '2026-06-15'.
function fixedNow(): Date {
  return new Date('2026-06-15T12:00:00.000Z');
}

describe('addDaysIso', () => {
  it('suma dias positivos cross-mes', () => {
    expect(addDaysIso('2026-06-30', 1)).toBe('2026-07-01');
  });

  it('suma dias negativos cross-mes', () => {
    expect(addDaysIso('2026-07-01', -1)).toBe('2026-06-30');
  });

  it('suma dias cross-anio', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('bisiesto: feb 28 + 1 en 2028 = feb 29', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('no-bisiesto: feb 28 + 1 en 2026 = mar 1', () => {
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('groupEventsByBucket', () => {
  it('evento overdue (fecha < today) cae en hoy', () => {
    const ev = makeEvent({ id: 'a', fecha_vencimiento: '2026-06-10' });
    const buckets = groupEventsByBucket([ev], fixedNow());
    expect(buckets.hoy).toHaveLength(1);
    expect(buckets.hoy[0]?.id).toBe('a');
    expect(buckets.siete).toHaveLength(0);
    expect(buckets.treinta).toHaveLength(0);
    expect(buckets.masAdelante).toHaveLength(0);
  });

  it('evento today cae en hoy', () => {
    const ev = makeEvent({ id: 'a', fecha_vencimiento: '2026-06-15' });
    const buckets = groupEventsByBucket([ev], fixedNow());
    expect(buckets.hoy.map((e) => e.id)).toEqual(['a']);
  });

  it('evento today+1 cae en siete', () => {
    const ev = makeEvent({ id: 'a', fecha_vencimiento: '2026-06-16' });
    const buckets = groupEventsByBucket([ev], fixedNow());
    expect(buckets.siete.map((e) => e.id)).toEqual(['a']);
    expect(buckets.hoy).toHaveLength(0);
  });

  it('evento today+7 cae en siete (borde inclusive)', () => {
    const ev = makeEvent({ id: 'a', fecha_vencimiento: '2026-06-22' });
    const buckets = groupEventsByBucket([ev], fixedNow());
    expect(buckets.siete.map((e) => e.id)).toEqual(['a']);
    expect(buckets.treinta).toHaveLength(0);
  });

  it('evento today+8 cae en treinta', () => {
    const ev = makeEvent({ id: 'a', fecha_vencimiento: '2026-06-23' });
    const buckets = groupEventsByBucket([ev], fixedNow());
    expect(buckets.treinta.map((e) => e.id)).toEqual(['a']);
    expect(buckets.siete).toHaveLength(0);
  });

  it('evento today+30 cae en treinta (borde inclusive)', () => {
    const ev = makeEvent({ id: 'a', fecha_vencimiento: '2026-07-15' });
    const buckets = groupEventsByBucket([ev], fixedNow());
    expect(buckets.treinta.map((e) => e.id)).toEqual(['a']);
    expect(buckets.masAdelante).toHaveLength(0);
  });

  it('evento today+31 cae en masAdelante', () => {
    const ev = makeEvent({ id: 'a', fecha_vencimiento: '2026-07-16' });
    const buckets = groupEventsByBucket([ev], fixedNow());
    expect(buckets.masAdelante.map((e) => e.id)).toEqual(['a']);
    expect(buckets.treinta).toHaveLength(0);
  });

  it('eventos completed y cancelled NO entran a ningun bucket (silent drop)', () => {
    const completedToday = makeEvent({
      id: 'c',
      fecha_vencimiento: '2026-06-15',
      status: 'completed',
    });
    const cancelledIn5d = makeEvent({
      id: 'x',
      fecha_vencimiento: '2026-06-20',
      status: 'cancelled',
    });
    const pendingToday = makeEvent({
      id: 'p',
      fecha_vencimiento: '2026-06-15',
      status: 'pending',
    });
    const buckets = groupEventsByBucket([completedToday, cancelledIn5d, pendingToday], fixedNow());
    expect(buckets.hoy.map((e) => e.id)).toEqual(['p']);
    expect(buckets.siete).toHaveLength(0);
    expect(buckets.treinta).toHaveLength(0);
    expect(buckets.masAdelante).toHaveLength(0);
  });

  it('sort intra-bucket: fecha ASC + id ASC estable', () => {
    const eventos = [
      // Mismo dia, diferentes ids — sort por id ASC
      makeEvent({ id: 'zzz', fecha_vencimiento: '2026-06-18' }),
      makeEvent({ id: 'aaa', fecha_vencimiento: '2026-06-18' }),
      // Otro dia anterior — debe ir primero
      makeEvent({ id: 'mid', fecha_vencimiento: '2026-06-16' }),
    ];
    const buckets = groupEventsByBucket(eventos, fixedNow());
    expect(buckets.siete.map((e) => e.id)).toEqual(['mid', 'aaa', 'zzz']);
  });

  it('cross-year: today=31-Dec → +7 cruza al anio siguiente correctamente', () => {
    const now = new Date('2026-12-31T12:00:00.000Z');
    const ev1 = makeEvent({ id: 'enero1', fecha_vencimiento: '2027-01-01' });
    const ev2 = makeEvent({ id: 'enero7', fecha_vencimiento: '2027-01-07' });
    const ev3 = makeEvent({ id: 'enero8', fecha_vencimiento: '2027-01-08' });
    const buckets = groupEventsByBucket([ev1, ev2, ev3], now);
    expect(buckets.siete.map((e) => e.id)).toEqual(['enero1', 'enero7']);
    expect(buckets.treinta.map((e) => e.id)).toEqual(['enero8']);
  });

  it('bisiesto: today=28-Feb-2028 + 1 = 29-Feb-2028 cae en siete', () => {
    const now = new Date('2028-02-28T12:00:00.000Z');
    const ev = makeEvent({ id: 'a', fecha_vencimiento: '2028-02-29' });
    const buckets = groupEventsByBucket([ev], now);
    expect(buckets.siete.map((e) => e.id)).toEqual(['a']);
  });

  it('arreglo vacio devuelve 4 buckets vacios', () => {
    const buckets = groupEventsByBucket([], fixedNow());
    expect(buckets.hoy).toEqual([]);
    expect(buckets.siete).toEqual([]);
    expect(buckets.treinta).toEqual([]);
    expect(buckets.masAdelante).toEqual([]);
  });

  it('mix completo: 1 evento por bucket, en orden no-sorteado de input', () => {
    const eventos = [
      makeEvent({ id: 'masA', fecha_vencimiento: '2026-08-01' }), // +47
      makeEvent({ id: '7d', fecha_vencimiento: '2026-06-20' }), // +5
      makeEvent({ id: 'hoy', fecha_vencimiento: '2026-06-15' }), // 0
      makeEvent({ id: '30d', fecha_vencimiento: '2026-07-05' }), // +20
    ];
    const buckets = groupEventsByBucket(eventos, fixedNow());
    expect(buckets.hoy.map((e) => e.id)).toEqual(['hoy']);
    expect(buckets.siete.map((e) => e.id)).toEqual(['7d']);
    expect(buckets.treinta.map((e) => e.id)).toEqual(['30d']);
    expect(buckets.masAdelante.map((e) => e.id)).toEqual(['masA']);
  });
});
