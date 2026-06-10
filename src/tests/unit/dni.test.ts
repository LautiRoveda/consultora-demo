import { describe, expect, it } from 'vitest';

import { DNI_REGEX_INPUT, dniField, formatDni, normalizeDni } from '@/shared/templates/common/dni';

describe('normalizeDni', () => {
  it('strip puntos', () => {
    expect(normalizeDni('12.345.678')).toBe('12345678');
  });

  it('strip espacios', () => {
    expect(normalizeDni('12 345 678')).toBe('12345678');
  });

  it('strip guiones', () => {
    expect(normalizeDni('12-345-678')).toBe('12345678');
  });

  it('strip combinación + trim externo', () => {
    expect(normalizeDni('  12.345-678  ')).toBe('12345678');
  });

  it('idempotente sobre digits-only', () => {
    expect(normalizeDni('12345678')).toBe('12345678');
  });

  it('respeta 7 dígitos (DNI legacy)', () => {
    expect(normalizeDni('1.234.567')).toBe('1234567');
  });
});

describe('formatDni', () => {
  it('8 dígitos → XX.XXX.XXX', () => {
    expect(formatDni('12345678')).toBe('12.345.678');
  });

  it('7 dígitos → X.XXX.XXX', () => {
    expect(formatDni('1234567')).toBe('1.234.567');
  });

  it('input no-digits fallback unchanged', () => {
    expect(formatDni('not-a-dni')).toBe('not-a-dni');
  });

  it('input <7 dígitos fallback unchanged', () => {
    expect(formatDni('123456')).toBe('123456');
  });

  it('input >8 dígitos fallback unchanged', () => {
    expect(formatDni('123456789')).toBe('123456789');
  });
});

describe('dniField', () => {
  it('acepta DNI digits-only 8 dígitos', () => {
    expect(dniField.safeParse('12345678').success).toBe(true);
  });

  it('acepta DNI con puntos', () => {
    expect(dniField.safeParse('12.345.678').success).toBe(true);
  });

  it('acepta DNI legacy 7 dígitos', () => {
    expect(dniField.safeParse('1234567').success).toBe(true);
  });

  it('rechaza DNI con letras', () => {
    expect(dniField.safeParse('1234A678').success).toBe(false);
  });

  it('rechaza DNI muy corto', () => {
    expect(dniField.safeParse('123').success).toBe(false);
  });

  // T-135 (L-2) · digits-only 9-12 pasan DNI_REGEX_INPUT (permisivo por los
  // separadores) pero violan el CHECK SQL `^\d{7,8}$` — sin el refine llegaban
  // al INSERT y reventaban con error genérico.
  it('rechaza 9 dígitos puros (pasaba el regex permisivo, violaba el CHECK SQL)', () => {
    expect(dniField.safeParse('123456789').success).toBe(false);
  });

  it('rechaza 12 dígitos puros (extremo superior del regex permisivo)', () => {
    expect(dniField.safeParse('123456789012').success).toBe(false);
  });

  it('rechaza 9 dígitos con puntos (el refine valida post-normalización)', () => {
    expect(dniField.safeParse('123.456.789').success).toBe(false);
  });
});

describe('DNI_REGEX_INPUT', () => {
  it('coincide con dnis permitidos por dniField', () => {
    expect(DNI_REGEX_INPUT.test('12345678')).toBe(true);
    expect(DNI_REGEX_INPUT.test('12.345.678')).toBe(true);
    expect(DNI_REGEX_INPUT.test('1234567')).toBe(true);
  });
});
