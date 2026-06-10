import { describe, expect, it } from 'vitest';

import {
  CAMPO_LABEL_MAX,
  CAMPO_VALOR_MAX,
  campoPersonalizadoSchema,
  CAMPOS_PERSONALIZADOS_MAX,
  camposPersonalizadosField,
  INSTRUCCIONES_ADICIONALES_MAX,
  instruccionesAdicionalesField,
  normalizeCamposPersonalizados,
  normalizeInstruccionesAdicionales,
} from '@/shared/templates/common/campos-extra';

/**
 * T-138 fase 1 · Factories Zod + normalizadores de la personalizacion
 * compartida. Los caps son la primera defensa (costo en tokens + foco del
 * modelo) — anclarlos evita que un refactor los afloje sin querer.
 */

describe('campoPersonalizadoSchema', () => {
  it('happy path: label + valor validos', () => {
    const r = campoPersonalizadoSchema.safeParse({
      label: 'N° de expediente',
      valor: 'EXP-2026-001',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza label vacio y valor vacio', () => {
    expect(campoPersonalizadoSchema.safeParse({ label: '', valor: 'x' }).success).toBe(false);
    expect(campoPersonalizadoSchema.safeParse({ label: 'x', valor: '' }).success).toBe(false);
    // Whitespace-only tambien: trim corre antes del min(1).
    expect(campoPersonalizadoSchema.safeParse({ label: '   ', valor: 'x' }).success).toBe(false);
  });

  it('rechaza label > 60 y valor > 500', () => {
    expect(
      campoPersonalizadoSchema.safeParse({ label: 'a'.repeat(CAMPO_LABEL_MAX + 1), valor: 'x' })
        .success,
    ).toBe(false);
    expect(
      campoPersonalizadoSchema.safeParse({ label: 'x', valor: 'a'.repeat(CAMPO_VALOR_MAX + 1) })
        .success,
    ).toBe(false);
  });
});

describe('camposPersonalizadosField', () => {
  const schema = camposPersonalizadosField();

  it('es opcional: undefined parsea', () => {
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it('acepta hasta el cap y rechaza cap + 1', () => {
    const item = { label: 'L', valor: 'v' };
    expect(
      schema.safeParse(Array.from({ length: CAMPOS_PERSONALIZADOS_MAX }, () => item)).success,
    ).toBe(true);
    expect(
      schema.safeParse(Array.from({ length: CAMPOS_PERSONALIZADOS_MAX + 1 }, () => item)).success,
    ).toBe(false);
  });
});

describe('instruccionesAdicionalesField', () => {
  const schema = instruccionesAdicionalesField();

  it('es opcional: undefined y "" parsean', () => {
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse('').success).toBe(true);
  });

  it('acepta el cap exacto y rechaza cap + 1', () => {
    expect(schema.safeParse('a'.repeat(INSTRUCCIONES_ADICIONALES_MAX)).success).toBe(true);
    expect(schema.safeParse('a'.repeat(INSTRUCCIONES_ADICIONALES_MAX + 1)).success).toBe(false);
  });
});

describe('normalizadores', () => {
  it('normalizeCamposPersonalizados: [] → undefined, no-vacio se preserva, idempotente', () => {
    expect(normalizeCamposPersonalizados([])).toBeUndefined();
    expect(normalizeCamposPersonalizados(undefined)).toBeUndefined();

    const campos = [{ label: 'L', valor: 'v' }];
    expect(normalizeCamposPersonalizados(campos)).toEqual(campos);
    expect(normalizeCamposPersonalizados(normalizeCamposPersonalizados(campos))).toEqual(campos);
  });

  it('normalizeInstruccionesAdicionales: "" → undefined, texto se preserva, idempotente', () => {
    expect(normalizeInstruccionesAdicionales('')).toBeUndefined();
    expect(normalizeInstruccionesAdicionales(undefined)).toBeUndefined();
    expect(normalizeInstruccionesAdicionales('foco en EPP')).toBe('foco en EPP');
    expect(
      normalizeInstruccionesAdicionales(normalizeInstruccionesAdicionales('foco en EPP')),
    ).toBe('foco en EPP');
  });
});
