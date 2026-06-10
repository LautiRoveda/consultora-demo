import type { AccidenteMetadata } from '@/shared/templates/accidente/schema';
import { describe, expect, it } from 'vitest';

import { renderAccidenteMetadataAsPromptContext } from '@/shared/templates/accidente/render';
import {
  accidenteMetadataSchema,
  normalizeAccidenteMetadata,
} from '@/shared/templates/accidente/schema';

const validFixture: AccidenteMetadata = {
  razon_social: 'Talleres Metalúrgicos SA',
  cuit: '30-55566677-8',
  domicilio: 'Calle 9 de Julio 1500',
  fecha_accidente: '2026-05-11',
  hora_accidente: '14:30',
  lugar_especifico: 'Línea de prensa, sector B',
  puesto_afectado: 'Operario de prensa',
  tipo_lesion: ['herida_cortante', 'contusion'],
  partes_cuerpo_afectadas: ['manos', 'miembros_superiores'],
  gravedad: 'grave',
  dias_baja_estimados: 15,
  testigos_presentes: true,
  descripcion_inicial:
    'Operario sufrió corte en mano derecha al retirar guarda de seguridad para destrabar pieza.',
};

describe('accidenteMetadataSchema', () => {
  it('happy path: parsea fixture completa', () => {
    const r = accidenteMetadataSchema.safeParse(validFixture);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.gravedad).toBe('grave');
      expect(r.data.testigos_presentes).toBe(true);
      expect(r.data.dias_baja_estimados).toBe(15);
    }
  });

  it('acepta dias_baja_estimados undefined (opcional)', () => {
    const m = { ...validFixture, dias_baja_estimados: undefined };
    const r = accidenteMetadataSchema.safeParse(m);
    expect(r.success).toBe(true);
  });

  it('rechaza hora_accidente con formato invalido', () => {
    const bad = { ...validFixture, hora_accidente: '25:99' };
    const r = accidenteMetadataSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rechaza descripcion_inicial < 10 caracteres', () => {
    const bad = { ...validFixture, descripcion_inicial: 'corta' };
    const r = accidenteMetadataSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rechaza tipo_lesion vacio o fuera de enum', () => {
    expect(accidenteMetadataSchema.safeParse({ ...validFixture, tipo_lesion: [] }).success).toBe(
      false,
    );
    expect(
      accidenteMetadataSchema.safeParse({ ...validFixture, tipo_lesion: ['inventado'] }).success,
    ).toBe(false);
  });

  it('normalize idempotente y normaliza CUIT', () => {
    const m = { ...validFixture, cuit: '30555666778' }; // sin guiones
    const n = normalizeAccidenteMetadata(m);
    expect(n.cuit).toBe('30-55566677-8');
  });

  it('render incluye lesiones/partes traducidas + footer anti-alucinacion', () => {
    const out = renderAccidenteMetadataAsPromptContext(validFixture);
    expect(out).toContain('Herida cortante');
    expect(out).toContain('Manos');
    expect(out).toContain('Grave (baja prolongada)');
    expect(out).toContain('Testigos presentes: Sí');
    expect(out).toContain('Días de baja estimados: 15');
    // Footer enfatiza no inventar causa raiz ni testigos.
    expect(out).toMatch(/NO inventes causa raíz/);
    expect(out).toMatch(/matriz de investigación/);
  });
});

describe('accidente · personalizacion (T-138 fase 1)', () => {
  it('backward-compat: la fixture pre-T-138 parsea con los campos nuevos undefined', () => {
    const r = accidenteMetadataSchema.safeParse(validFixture);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.campos_personalizados).toBeUndefined();
    expect(r.data.instrucciones_adicionales).toBeUndefined();
  });

  it('acepta campos_personalizados + instrucciones_adicionales', () => {
    const r = accidenteMetadataSchema.safeParse({
      ...validFixture,
      campos_personalizados: [{ label: 'N° de siniestro ART', valor: 'SIN-44521' }],
      instrucciones_adicionales: 'detallá la jerarquía de controles en las correctivas',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.campos_personalizados).toHaveLength(1);
  });

  it('rechaza campos_personalizados sobre el cap (10)', () => {
    const r = accidenteMetadataSchema.safeParse({
      ...validFixture,
      campos_personalizados: Array.from({ length: 11 }, () => ({ label: 'L', valor: 'v' })),
    });
    expect(r.success).toBe(false);
  });

  it("normalize: [] y '' de personalizacion → undefined", () => {
    const n = normalizeAccidenteMetadata({
      ...validFixture,
      campos_personalizados: [],
      instrucciones_adicionales: '',
    });
    expect(n.campos_personalizados).toBeUndefined();
    expect(n.instrucciones_adicionales).toBeUndefined();
  });

  it('render: bloques de personalizacion entre los datos y el footer', () => {
    const out = renderAccidenteMetadataAsPromptContext({
      ...validFixture,
      campos_personalizados: [{ label: 'N° de siniestro ART', valor: 'SIN-44521' }],
      instrucciones_adicionales: 'jerarquía de controles',
    });
    const camposIdx = out.indexOf('Campos personalizados');
    const instruccionesIdx = out.indexOf('Instrucciones adicionales del consultor');
    const footerIdx = out.indexOf('Generá el informe de accidente');
    expect(camposIdx).toBeGreaterThan(out.indexOf('**Descripción inicial'));
    expect(instruccionesIdx).toBeGreaterThan(camposIdx);
    expect(footerIdx).toBeGreaterThan(instruccionesIdx);
  });
});
