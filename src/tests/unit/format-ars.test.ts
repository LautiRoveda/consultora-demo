/**
 * T-072 · Tests del formateador ARS desde centavos.
 */
import { describe, expect, it } from 'vitest';

import { formatARS } from '@/shared/lib/format-ars';
import { trialDaysLeft } from '@/shared/lib/trial-days';

describe('formatARS', () => {
  it('3000000 centavos → "ARS 30.000"', () => {
    expect(formatARS(3_000_000)).toBe('ARS 30.000');
  });

  it('0 centavos → "ARS 0"', () => {
    expect(formatARS(0)).toBe('ARS 0');
  });

  it('150 centavos (redondea) → "ARS 2"', () => {
    expect(formatARS(150)).toBe('ARS 2');
  });

  it('100000000 centavos → "ARS 1.000.000" (millones con thousand separator es-AR)', () => {
    expect(formatARS(100_000_000)).toBe('ARS 1.000.000');
  });
});

describe('trialDaysLeft', () => {
  it('null trialHasta → null', () => {
    expect(trialDaysLeft(null)).toBeNull();
  });

  it('trialHasta inválido → null', () => {
    expect(trialDaysLeft('not-a-date')).toBeNull();
  });

  it('trialHasta a 5 días → 5', () => {
    const now = new Date('2026-05-01T00:00:00.000Z');
    const trialHasta = new Date('2026-05-06T00:00:00.000Z').toISOString();
    expect(trialDaysLeft(trialHasta, now)).toBe(5);
  });

  it('trialHasta a 6h en el futuro → 1 (ceil para evitar flash "vencido" durante último día)', () => {
    const now = new Date('2026-05-01T00:00:00.000Z');
    const trialHasta = new Date('2026-05-01T06:00:00.000Z').toISOString();
    expect(trialDaysLeft(trialHasta, now)).toBe(1);
  });

  it('trialHasta pasado → ≤ 0', () => {
    const now = new Date('2026-05-10T00:00:00.000Z');
    const trialHasta = new Date('2026-05-05T00:00:00.000Z').toISOString();
    expect(trialDaysLeft(trialHasta, now)).toBeLessThanOrEqual(0);
  });
});
