import { describe, expect, it } from 'vitest';

import { optionalString } from '@/shared/lib/zod-form-helpers';

describe('optionalString', () => {
  const schema = optionalString({ min: 2, max: 10, label: 'el campo' });

  it("acepta '' (campo no cargado)", () => {
    const result = schema.safeParse('');
    expect(result.success).toBe(true);
  });

  it('acepta valor in-range (length entre min y max)', () => {
    const result = schema.safeParse('valor ok');
    expect(result.success).toBe(true);
  });

  it('acepta valor exactamente en min', () => {
    const result = schema.safeParse('ab');
    expect(result.success).toBe(true);
  });

  it('acepta valor exactamente en max', () => {
    const result = schema.safeParse('1234567890');
    expect(result.success).toBe(true);
  });

  it('rechaza valor con length < min con el mensaje canonical', () => {
    const result = schema.safeParse('a');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Si lo completás, el campo debe tener entre 2 y 10 caracteres.',
      );
    }
  });

  it('rechaza valor con length > max', () => {
    const result = schema.safeParse('12345678901');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Si lo completás, el campo debe tener entre 2 y 10 caracteres.',
      );
    }
  });

  it('trim previo al check (espacios laterales no cuentan)', () => {
    const result = schema.safeParse('  ab  ');
    expect(result.success).toBe(true);
  });

  it('default min = 1 cuando no se pasa min', () => {
    const schemaDefault = optionalString({ max: 5, label: 'opcional' });
    expect(schemaDefault.safeParse('').success).toBe(true);
    expect(schemaDefault.safeParse('a').success).toBe(true);
    expect(schemaDefault.safeParse('abcde').success).toBe(true);
    const tooLong = schemaDefault.safeParse('abcdef');
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues[0]?.message).toBe(
        'Si lo completás, opcional debe tener entre 1 y 5 caracteres.',
      );
    }
  });
});
