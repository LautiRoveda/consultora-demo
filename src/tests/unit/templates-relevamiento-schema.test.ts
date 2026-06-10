import type { RelevamientoMetadata } from '@/shared/templates/relevamiento/schema';
import { describe, expect, it } from 'vitest';

import { renderRelevamientoMetadataAsPromptContext } from '@/shared/templates/relevamiento/render';
import {
  normalizeRelevamientoMetadata,
  relevamientoMetadataSchema,
} from '@/shared/templates/relevamiento/schema';

const validFixture: RelevamientoMetadata = {
  razon_social: 'Frigorífico del Sur SRL',
  cuit: '30-11122233-4',
  domicilio: 'Ruta 8 Km 47',
  localidad: 'Pilar',
  provincia: 'BA',
  fecha_relevamiento: '2026-05-10',
  areas_relevadas: ['Producción / planta', 'Sala de máquinas', 'Cámara frigorífica'],
  agentes_a_relevar: ['ruido', 'carga_termica', 'ergonomia'],
  equipos_medicion: 'Sonómetro Quest, dataloggers WBGT.',
};

describe('relevamientoMetadataSchema', () => {
  it('happy path: parsea fixture completa', () => {
    const r = relevamientoMetadataSchema.safeParse(validFixture);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.agentes_a_relevar).toContain('ruido');
      expect(r.data.areas_relevadas).toHaveLength(3);
    }
  });

  it('rechaza areas_relevadas vacio', () => {
    const r = relevamientoMetadataSchema.safeParse({ ...validFixture, areas_relevadas: [] });
    expect(r.success).toBe(false);
  });

  it('rechaza agentes_a_relevar fuera del enum', () => {
    const bad = { ...validFixture, agentes_a_relevar: ['inventado'] };
    const r = relevamientoMetadataSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rechaza provincia fuera del enum', () => {
    const bad = { ...validFixture, provincia: 'XX' };
    const r = relevamientoMetadataSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("normalize convierte '' equipos_medicion a undefined", () => {
    const m = { ...validFixture, equipos_medicion: '' };
    const n = normalizeRelevamientoMetadata(m);
    expect(n.equipos_medicion).toBeUndefined();
  });

  it('render incluye agentes con labels traducidos + footer SRT', () => {
    const out = renderRelevamientoMetadataAsPromptContext(validFixture);
    expect(out).toContain('Carga térmica (WBGT)'); // label traducido
    expect(out).toContain('Ruido');
    expect(out).toContain('Ergonomía');
    expect(out).toMatch(/Decreto 351\/79/); // footer SRT
    expect(out).toMatch(/Res\. 295\/03/);
  });
});

describe('relevamiento · personalizacion (T-138 fase 1)', () => {
  it('backward-compat: la fixture pre-T-138 parsea con los campos nuevos undefined', () => {
    const r = relevamientoMetadataSchema.safeParse(validFixture);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.campos_personalizados).toBeUndefined();
    expect(r.data.instrucciones_adicionales).toBeUndefined();
  });

  it('acepta campos_personalizados + instrucciones_adicionales', () => {
    const r = relevamientoMetadataSchema.safeParse({
      ...validFixture,
      campos_personalizados: [{ label: 'N° de expediente', valor: 'EXP-2026-001' }],
      instrucciones_adicionales: 'priorizá recomendaciones de bajo costo',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.campos_personalizados).toHaveLength(1);
    expect(r.data.instrucciones_adicionales).toContain('bajo costo');
  });

  it('rechaza campos_personalizados sobre el cap (10)', () => {
    const r = relevamientoMetadataSchema.safeParse({
      ...validFixture,
      campos_personalizados: Array.from({ length: 11 }, () => ({ label: 'L', valor: 'v' })),
    });
    expect(r.success).toBe(false);
  });

  it("normalize: [] y '' de personalizacion → undefined", () => {
    const n = normalizeRelevamientoMetadata({
      ...validFixture,
      campos_personalizados: [],
      instrucciones_adicionales: '',
    });
    expect(n.campos_personalizados).toBeUndefined();
    expect(n.instrucciones_adicionales).toBeUndefined();
  });

  it('render: bloques de personalizacion entre los datos y el footer', () => {
    const out = renderRelevamientoMetadataAsPromptContext({
      ...validFixture,
      campos_personalizados: [{ label: 'Norma interna', valor: 'IRAM 3800' }],
      instrucciones_adicionales: 'foco en EPP',
    });
    const camposIdx = out.indexOf('Campos personalizados');
    const instruccionesIdx = out.indexOf('Instrucciones adicionales del consultor');
    const footerIdx = out.indexOf('Generá el informe de relevamiento técnico');
    expect(camposIdx).toBeGreaterThan(out.indexOf('**Alcance:**'));
    expect(instruccionesIdx).toBeGreaterThan(camposIdx);
    expect(footerIdx).toBeGreaterThan(instruccionesIdx);
  });
});
