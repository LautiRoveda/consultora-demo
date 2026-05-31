import { describe, expect, it } from 'vitest';

import { isoWeekId } from '@/shared/lib/iso-week';

/**
 * T-109 · Unit tests de isoWeekId. Foco en el borde de ano (semana 53/01),
 * que es donde un calculo naive (ano calendario en vez de ano-del-jueves) se
 * rompe.
 *
 * Construimos cada Date a las 12:00 UTC (= 09:00 ART) del dia civil dado, lejos
 * de cualquier cruce de TZ, para que todayCivilIsoAR devuelva ese mismo dia.
 */
const atArNoon = (civil: string) => new Date(`${civil}T12:00:00.000Z`);

describe('isoWeekId', () => {
  it('lunes 2026-05-25 (review T-109) -> 2026-W22', () => {
    expect(isoWeekId(atArNoon('2026-05-25'))).toBe('2026-W22');
  });

  it('borde 53/01: viernes 2021-01-01 -> 2020-W53 (ano del jueves, no calendario)', () => {
    expect(isoWeekId(atArNoon('2021-01-01'))).toBe('2020-W53');
  });

  it('lunes 2026-12-28 -> 2026-W53', () => {
    expect(isoWeekId(atArNoon('2026-12-28'))).toBe('2026-W53');
  });

  it('lunes 2027-01-04 -> 2027-W01', () => {
    expect(isoWeekId(atArNoon('2027-01-04'))).toBe('2027-W01');
  });

  it('jueves 2026-01-01 -> 2026-W01', () => {
    expect(isoWeekId(atArNoon('2026-01-01'))).toBe('2026-W01');
  });

  it('lunes 2026-01-05 -> 2026-W02 (padding W0X)', () => {
    expect(isoWeekId(atArNoon('2026-01-05'))).toBe('2026-W02');
  });
});
