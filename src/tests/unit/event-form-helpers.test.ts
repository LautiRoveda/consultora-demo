/**
 * T-029 · Tests de helpers del EventForm.
 *
 * Cobertura clave (ajustes 3 y 5 del plan T-029):
 *  - dateToCivilIso: el output matchea el dia "civil" del Date local del
 *    runtime, sin off-by-one por TZ shift que ocurre con `toISOString().slice`.
 *  - civilIsoToDate: roundtrip preserva el dia.
 *  - findOffsetsInPast: detecta correctamente cuando un offset cae antes de
 *    `now` dado el `SCHEDULED_AT_SEND_HOUR_UTC=12` del backend.
 */
import { describe, expect, it } from 'vitest';

import {
  civilIsoToDate,
  dateToCivilIso,
  findOffsetsInPast,
} from '@/app/(app)/calendario/event-form-helpers';

describe('dateToCivilIso (TZ bug fix)', () => {
  it('Date construido en local TZ con month 0-indexed → YYYY-MM-DD del dia local', () => {
    // new Date(2026, 5, 15) = "15 jun 2026 00:00 hora LOCAL del runtime",
    // sin importar si el runtime es UTC, ART o NZ.
    const d = new Date(2026, 5, 15);
    expect(dateToCivilIso(d)).toBe('2026-06-15');
  });

  it('ultimo dia del anio → no sufre wrap por shift UTC', () => {
    const d = new Date(2026, 11, 31, 23, 59, 0);
    expect(dateToCivilIso(d)).toBe('2026-12-31');
  });

  it('29 de febrero en anio bisiesto', () => {
    const d = new Date(2028, 1, 29);
    expect(dateToCivilIso(d)).toBe('2028-02-29');
  });

  it('hora alta del dia (23:30) NO altera el dia output (mantiene local)', () => {
    const d = new Date(2026, 5, 15, 23, 30, 0);
    expect(dateToCivilIso(d)).toBe('2026-06-15');
  });

  it('hora 00:01 NO retrocede al dia anterior', () => {
    const d = new Date(2026, 5, 15, 0, 1, 0);
    expect(dateToCivilIso(d)).toBe('2026-06-15');
  });
});

describe('civilIsoToDate (roundtrip)', () => {
  it('parsea YYYY-MM-DD a Date local con dia preservado', () => {
    const d = civilIsoToDate('2026-06-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // 0-indexed
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });

  it('roundtrip: civilIsoToDate → dateToCivilIso preserva el ISO', () => {
    const inputs = ['2026-01-01', '2026-06-15', '2026-12-31', '2028-02-29'];
    for (const iso of inputs) {
      expect(dateToCivilIso(civilIsoToDate(iso))).toBe(iso);
    }
  });
});

describe('findOffsetsInPast', () => {
  it('todos los offsets caen en futuro → array vacio', () => {
    // Vencimiento en 120 dias, offsets [60, 30, 7, 0] → todos caen en futuro.
    const now = new Date('2026-06-01T00:00:00.000Z');
    const fechaVenc = '2026-09-29'; // ~120 dias despues
    expect(findOffsetsInPast(fechaVenc, [60, 30, 7, 0], now)).toEqual([]);
  });

  it('offset 30 cae en pasado cuando vencimiento esta a 7 dias (now < send hour)', () => {
    // now = 8 ago 00:00 UTC. fechaVenc = 15 ago.
    //   offset 30 → 16 jul 12:00 UTC → pasado.
    //   offset  7 → 8 ago 12:00 UTC → futuro (now < 12:00 UTC).
    //   offset  0 → 15 ago 12:00 UTC → futuro.
    const now = new Date('2026-08-08T00:00:00.000Z');
    const fechaVenc = '2026-08-15';
    const result = findOffsetsInPast(fechaVenc, [30, 7, 0], now);
    expect(result).toEqual([30]);
  });

  it('offset 0 + 7 caen en pasado si now ya supero las 12 UTC del dia del scheduled_at', () => {
    // now = 8 ago 13:00 UTC → ya paso el send hour de offset 7 (12:00 UTC).
    const now = new Date('2026-08-08T13:00:00.000Z');
    const fechaVenc = '2026-08-15';
    const result = findOffsetsInPast(fechaVenc, [30, 7, 0], now);
    expect(result).toEqual([30, 7]);
  });

  it('todos los offsets caen en pasado → todos retornados', () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const fechaVenc = '2026-08-15';
    expect(findOffsetsInPast(fechaVenc, [30, 7, 0], now)).toEqual([30, 7, 0]);
  });

  it('preserva orden del input (sin reordenar)', () => {
    const now = new Date('2026-08-09T00:00:00.000Z');
    const fechaVenc = '2026-08-15';
    const result = findOffsetsInPast(fechaVenc, [7, 60, 0, 30], now);
    // 7 antes = 2026-08-08 12 UTC → pasado
    // 60 antes = 2026-06-16 → pasado
    // 0 = 2026-08-15 12 UTC → futuro
    // 30 antes = 2026-07-16 → pasado
    expect(result).toEqual([7, 60, 30]);
  });

  it('input vacio → vacio', () => {
    expect(findOffsetsInPast('2026-09-01', [], new Date())).toEqual([]);
  });
});
