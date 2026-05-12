import type { OtrosMetadata } from '@/shared/templates/otros/schema';
import { describe, expect, it } from 'vitest';

import { renderOtrosMetadataAsPromptContext } from '@/shared/templates/otros/render';
import { normalizeOtrosMetadata, otrosMetadataSchema } from '@/shared/templates/otros/schema';

const validFixture: OtrosMetadata = {
  razon_social: 'Inmobiliaria Pampa SRL',
  cuit: '30-77788899-0',
  tema_informe: 'Auditoría interna de sistema de gestión HyS',
  objetivos: 'Verificar cumplimiento ISO 45001 + revisión matriz de riesgos.',
};

describe('otrosMetadataSchema', () => {
  it('happy path: parsea fixture completa', () => {
    const r = otrosMetadataSchema.safeParse(validFixture);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tema_informe).toMatch(/Auditoría/);
    }
  });

  it('parsea sin objetivos (opcional)', () => {
    const m = { razon_social: 'X SA', cuit: '20-11122233-4', tema_informe: 'Tema test' };
    const r = otrosMetadataSchema.safeParse(m);
    expect(r.success).toBe(true);
  });

  it('rechaza tema_informe vacio', () => {
    const r = otrosMetadataSchema.safeParse({ ...validFixture, tema_informe: '' });
    expect(r.success).toBe(false);
  });

  it('rechaza CUIT mal formado', () => {
    const r = otrosMetadataSchema.safeParse({ ...validFixture, cuit: 'no-es-cuit' });
    expect(r.success).toBe(false);
  });

  it("normalize convierte '' objetivos a undefined", () => {
    const m = { ...validFixture, objetivos: '' };
    const n = normalizeOtrosMetadata(m);
    expect(n.objetivos).toBeUndefined();
  });

  it('render incluye tema + objetivos + footer minimalista', () => {
    const out = renderOtrosMetadataAsPromptContext(validFixture);
    expect(out).toContain('Tema:');
    expect(out).toContain('Auditoría interna');
    expect(out).toContain('Objetivos');
    // Footer no impone estructura especifica.
    expect(out).toMatch(/Generá el informe solicitado/);
    expect(out).toMatch(/adaptada al tema/);
  });

  it('schema NO incluye domicilio (otros wildcard)', () => {
    // Shape assertion: el objeto sin domicilio parsea OK.
    const r = otrosMetadataSchema.safeParse({
      razon_social: 'X SA',
      cuit: '20-11122233-4',
      tema_informe: 'Tema',
    });
    expect(r.success).toBe(true);
  });
});
