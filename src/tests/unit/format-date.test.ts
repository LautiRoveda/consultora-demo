/**
 * T-085 · Tests del helper format-date (TZ America/Argentina/Buenos_Aires).
 *
 * Estrategia: el helper hardcodea `timeZone: AR_TIMEZONE` en cada
 * `Intl.DateTimeFormat` → es inmune al runtime TZ (UTC del container, local
 * del browser). Los tests usan assertions hardcoded contra fechas conocidas;
 * si el helper rompiera por runtime TZ leak, los outputs serían distintos.
 *
 * Por eso NO manipulamos `process.env.TZ` en beforeEach. En Node, `Intl`
 * resuelve TZ al boot — cambiar la var en runtime no afecta el output. Eso
 * ES exactamente lo que estamos testeando.
 */
import { describe, expect, it } from 'vitest';

import {
  AR_LOCALE,
  AR_TIMEZONE,
  formatCivilDateAR,
  formatCivilDateLongAR,
  formatCivilDateLongWithWeekdayAR,
  formatCivilDateShortAR,
  formatDateAR,
  formatDateLongAR,
  formatDateLongWithWeekdayAR,
  formatDateTimeAR,
  formatRelativeAR,
  todayCivilIsoAR,
} from '@/shared/lib/format-date';

describe('format-date · constants', () => {
  it('AR_TIMEZONE es America/Argentina/Buenos_Aires', () => {
    expect(AR_TIMEZONE).toBe('America/Argentina/Buenos_Aires');
  });

  it('AR_LOCALE es es-AR', () => {
    expect(AR_LOCALE).toBe('es-AR');
  });
});

describe('formatDateAR · timestamptz UTC → "DD/MM/YYYY" en TZ AR', () => {
  it('UTC 16:00 → AR 13:00 mismo día', () => {
    expect(formatDateAR('2026-05-25T16:00:00Z')).toBe('25/05/2026');
  });

  it('UTC 02:00 → AR 23:00 día anterior (verifica TZ AR aplicada, no UTC literal)', () => {
    expect(formatDateAR('2026-05-25T02:00:00Z')).toBe('24/05/2026');
  });

  it('UTC 23:59 fin de año → AR 20:59 del mismo día', () => {
    expect(formatDateAR('2026-12-31T23:59:00Z')).toBe('31/12/2026');
  });

  it('UTC 02:00 de Año Nuevo → AR 23:00 del 31 de diciembre del año anterior', () => {
    expect(formatDateAR('2027-01-01T02:00:00Z')).toBe('31/12/2026');
  });

  it('acepta Date object', () => {
    expect(formatDateAR(new Date('2026-05-25T16:00:00Z'))).toBe('25/05/2026');
  });
});

describe('formatDateTimeAR · "DD/MM/YYYY HH:mm" en TZ AR, 24h', () => {
  it('UTC 16:30 → AR 13:30', () => {
    expect(formatDateTimeAR('2026-05-25T16:30:00Z')).toBe('25/05/2026 13:30');
  });

  it('UTC 02:00 → AR 23:00 día anterior', () => {
    expect(formatDateTimeAR('2026-05-25T02:00:00Z')).toBe('24/05/2026 23:00');
  });

  it('formato 24h (no AM/PM)', () => {
    expect(formatDateTimeAR('2026-05-25T20:45:00Z')).toBe('25/05/2026 17:45');
  });
});

describe('formatDateLongAR · "DD de mes de YYYY" en TZ AR', () => {
  it('25/05/2026 → "25 de mayo de 2026"', () => {
    expect(formatDateLongAR('2026-05-25T16:00:00Z')).toBe('25 de mayo de 2026');
  });

  it('mes en español lowercase, año sin separador', () => {
    expect(formatDateLongAR('2026-08-15T15:00:00Z')).toBe('15 de agosto de 2026');
  });
});

describe('formatDateLongWithWeekdayAR · "weekday, DD de mes de YYYY"', () => {
  it('lunes 25 mayo 2026', () => {
    expect(formatDateLongWithWeekdayAR('2026-05-25T16:00:00Z')).toBe('lunes, 25 de mayo de 2026');
  });
});

describe('formatRelativeAR · Intl.RelativeTimeFormat es-AR', () => {
  const now = new Date('2026-05-25T12:00:00Z');

  it('hace 3 días', () => {
    const past = new Date(now.getTime() - 3 * 86_400_000);
    expect(formatRelativeAR(past, now)).toBe('hace 3 días');
  });

  it('ayer (numeric: auto)', () => {
    const past = new Date(now.getTime() - 86_400_000);
    expect(formatRelativeAR(past, now)).toBe('ayer');
  });

  it('dentro de 2 horas', () => {
    const future = new Date(now.getTime() + 2 * 3_600_000);
    expect(formatRelativeAR(future, now)).toBe('dentro de 2 horas');
  });

  it('en 30 segundos', () => {
    const future = new Date(now.getTime() + 30_000);
    expect(formatRelativeAR(future, now)).toBe('dentro de 30 segundos');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Civil dates: NO se convierten TZ, el YYYY-MM-DD es literal del calendar.
// ════════════════════════════════════════════════════════════════════════════

describe('formatCivilDateAR · "DD/MM/YYYY" desde YYYY-MM-DD literal', () => {
  it('2026-05-25 → "25/05/2026" (sin off-by-one)', () => {
    expect(formatCivilDateAR('2026-05-25')).toBe('25/05/2026');
  });

  it('2026-01-01 → "01/01/2026"', () => {
    expect(formatCivilDateAR('2026-01-01')).toBe('01/01/2026');
  });

  it('2026-12-31 → "31/12/2026"', () => {
    expect(formatCivilDateAR('2026-12-31')).toBe('31/12/2026');
  });
});

describe('formatCivilDateLongAR · "DD de mes de YYYY" desde civil', () => {
  it('2026-05-25 → "25 de mayo de 2026"', () => {
    expect(formatCivilDateLongAR('2026-05-25')).toBe('25 de mayo de 2026');
  });

  it('2026-06-15 → "15 de junio de 2026" (matchea email reminder template)', () => {
    expect(formatCivilDateLongAR('2026-06-15')).toBe('15 de junio de 2026');
  });
});

describe('formatCivilDateLongWithWeekdayAR · weekday + long civil', () => {
  it('2026-05-25 → "lunes, 25 de mayo de 2026"', () => {
    expect(formatCivilDateLongWithWeekdayAR('2026-05-25')).toBe('lunes, 25 de mayo de 2026');
  });
});

describe('formatCivilDateShortAR · mes abreviado', () => {
  it('2026-05-25 → "25 de may de 2026"', () => {
    expect(formatCivilDateShortAR('2026-05-25')).toBe('25 de may de 2026');
  });
});

describe('todayCivilIsoAR · YYYY-MM-DD del día calendario AR', () => {
  it('UTC 16:00 → AR 13:00 mismo día', () => {
    expect(todayCivilIsoAR(new Date('2026-05-25T16:00:00Z'))).toBe('2026-05-25');
  });

  it('UTC 02:00 → AR 23:00 día anterior', () => {
    expect(todayCivilIsoAR(new Date('2026-05-25T02:00:00Z'))).toBe('2026-05-24');
  });

  it('UTC 02:00 Año Nuevo → AR 31 de diciembre del año anterior', () => {
    expect(todayCivilIsoAR(new Date('2027-01-01T02:00:00Z'))).toBe('2026-12-31');
  });

  it('default arg = new Date() (smoke test, formato YYYY-MM-DD)', () => {
    expect(todayCivilIsoAR()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
