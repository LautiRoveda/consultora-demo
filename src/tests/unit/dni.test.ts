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
});

describe('DNI_REGEX_INPUT', () => {
  it('coincide con dnis permitidos por dniField', () => {
    expect(DNI_REGEX_INPUT.test('12345678')).toBe(true);
    expect(DNI_REGEX_INPUT.test('12.345.678')).toBe(true);
    expect(DNI_REGEX_INPUT.test('1234567')).toBe(true);
  });
});
