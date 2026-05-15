/**
 * T-029 · Tests de exhaustividad de labels + helper formatRecurrence.
 */
import { describe, expect, it } from 'vitest';

import { EVENT_STATUS_VALUES, EVENT_TIPO_VALUES } from '@/app/(app)/calendario/defaults';
import {
  EVENT_STATUS_LABELS,
  EVENT_TIPO_LABELS,
  formatRecurrence,
} from '@/app/(app)/calendario/labels';

describe('label exhaustiveness', () => {
  it('EVENT_TIPO_LABELS cubre los 7 valores del enum', () => {
    for (const tipo of EVENT_TIPO_VALUES) {
      expect(EVENT_TIPO_LABELS[tipo]).toBeTruthy();
      expect(EVENT_TIPO_LABELS[tipo].length).toBeGreaterThan(0);
    }
    expect(Object.keys(EVENT_TIPO_LABELS).length).toBe(EVENT_TIPO_VALUES.length);
  });

  it('EVENT_STATUS_LABELS cubre los 3 valores del enum', () => {
    for (const status of EVENT_STATUS_VALUES) {
      expect(EVENT_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(Object.keys(EVENT_STATUS_LABELS).length).toBe(EVENT_STATUS_VALUES.length);
  });
});

describe('formatRecurrence', () => {
  it('null → "Sin recurrencia"', () => {
    expect(formatRecurrence(null)).toBe('Sin recurrencia');
  });

  it('1 → "Cada mes"', () => {
    expect(formatRecurrence(1)).toBe('Cada mes');
  });

  it('12 → "Cada año"', () => {
    expect(formatRecurrence(12)).toBe('Cada año');
  });

  it('multiplo de 12 → "Cada N años"', () => {
    expect(formatRecurrence(24)).toBe('Cada 2 años');
    expect(formatRecurrence(60)).toBe('Cada 5 años');
  });

  it('no-multiplo de 12 → "Cada N meses"', () => {
    expect(formatRecurrence(6)).toBe('Cada 6 meses');
    expect(formatRecurrence(18)).toBe('Cada 18 meses');
  });
});
