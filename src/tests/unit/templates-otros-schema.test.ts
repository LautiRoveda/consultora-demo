import type { OtrosMetadata } from '@/shared/templates/otros/schema';
import { describe, expect, it } from 'vitest';

import { renderOtrosMetadataAsPromptContext } from '@/shared/templates/otros/render';
import { normalizeOtrosMetadata, otrosMetadataSchema } from '@/shared/templates/otros/schema';
import { SECCION_IDS_OTROS } from '@/shared/templates/otros/secciones';

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

describe('otros · personalizacion (T-138 fase 1)', () => {
  it('backward-compat: la fixture pre-T-138 parsea con los campos nuevos undefined', () => {
    const r = otrosMetadataSchema.safeParse(validFixture);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.campos_personalizados).toBeUndefined();
    expect(r.data.instrucciones_adicionales).toBeUndefined();
  });

  it('acepta campos_personalizados + instrucciones_adicionales', () => {
    const r = otrosMetadataSchema.safeParse({
      ...validFixture,
      campos_personalizados: [{ label: 'Solicitante', valor: 'Gerencia de planta' }],
      instrucciones_adicionales: 'tono ejecutivo, máximo 3 páginas',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.campos_personalizados).toHaveLength(1);
  });

  it('rechaza campos_personalizados sobre el cap (10)', () => {
    const r = otrosMetadataSchema.safeParse({
      ...validFixture,
      campos_personalizados: Array.from({ length: 11 }, () => ({ label: 'L', valor: 'v' })),
    });
    expect(r.success).toBe(false);
  });

  it("normalize: [] y '' de personalizacion → undefined", () => {
    const n = normalizeOtrosMetadata({
      ...validFixture,
      campos_personalizados: [],
      instrucciones_adicionales: '',
    });
    expect(n.campos_personalizados).toBeUndefined();
    expect(n.instrucciones_adicionales).toBeUndefined();
  });

  it('render: bloques de personalizacion entre los datos y el footer', () => {
    const out = renderOtrosMetadataAsPromptContext({
      ...validFixture,
      campos_personalizados: [{ label: 'Solicitante', valor: 'Gerencia de planta' }],
      instrucciones_adicionales: 'tono ejecutivo',
    });
    const camposIdx = out.indexOf('Campos personalizados');
    const instruccionesIdx = out.indexOf('Instrucciones adicionales del consultor');
    const footerIdx = out.indexOf('Generá el informe solicitado');
    expect(camposIdx).toBeGreaterThan(out.indexOf('**Solicitud:**'));
    expect(instruccionesIdx).toBeGreaterThan(camposIdx);
    expect(footerIdx).toBeGreaterThan(instruccionesIdx);
  });
});

describe('otros · secciones configurables (T-138 fase 2)', () => {
  const config = [
    { kind: 'catalogo', seccion_id: 'objeto' },
    { kind: 'catalogo', seccion_id: 'desarrollo' },
    { kind: 'custom', titulo: 'Matriz de hallazgos', descripcion: 'Tabla criticidad x área' },
  ];

  it('acepta config valida (estructura libre: sin secciones obligatorias)', () => {
    expect(otrosMetadataSchema.safeParse({ ...validFixture, secciones: config }).success).toBe(
      true,
    );
    // Incluso un subset minimo de 1 seccion es valido en "otros".
    expect(
      otrosMetadataSchema.safeParse({
        ...validFixture,
        secciones: [{ kind: 'catalogo', seccion_id: 'desarrollo' }],
      }).success,
    ).toBe(true);
  });

  it('normalize: config default → undefined; no-default se preserva', () => {
    const def = SECCION_IDS_OTROS.map((id) => ({ kind: 'catalogo' as const, seccion_id: id }));
    const r = otrosMetadataSchema.safeParse({ ...validFixture, secciones: def });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(normalizeOtrosMetadata(r.data).secciones).toBeUndefined();

    const r2 = otrosMetadataSchema.safeParse({ ...validFixture, secciones: config });
    expect(r2.success).toBe(true);
    if (!r2.success) return;
    expect(normalizeOtrosMetadata(r2.data).secciones).toHaveLength(3);
  });

  it('render: bloque "Estructura solicitada" antes del footer', () => {
    const r = otrosMetadataSchema.safeParse({ ...validFixture, secciones: config });
    expect(r.success).toBe(true);
    if (!r.success) return;

    const out = renderOtrosMetadataAsPromptContext(r.data);
    expect(out).toContain('1. Objeto del informe');
    expect(out).toContain('2. Desarrollo');
    expect(out).toContain(
      '3. [Sección personalizada] Matriz de hallazgos — Tabla criticidad x área',
    );
    expect(out.indexOf('Generá el informe solicitado')).toBeGreaterThan(
      out.indexOf('Estructura solicitada'),
    );
  });
});
