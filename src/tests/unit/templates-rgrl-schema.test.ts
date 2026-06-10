import type { RgrlMetadata } from '@/shared/templates/rgrl/schema';
import { describe, expect, it } from 'vitest';

import { renderRgrlMetadataAsPromptContext } from '@/shared/templates/rgrl/render';
import { normalizeRgrlMetadata, rgrlMetadataSchema } from '@/shared/templates/rgrl/schema';

/**
 * T-138 · Tests del schema + render RGRL para la superficie de
 * personalizacion. El RGRL no tenia unit test de schema propio (la cobertura
 * pre-T-138 vive en integration: informes-content/metadata-actions) — este
 * archivo cubre SOLO lo que T-138 agrega, con el backward-compat explicito.
 */

const validFixture: RgrlMetadata = {
  razon_social: 'Metalúrgica del Sur SA',
  cuit: '30-12345678-9',
  domicilio: 'Av. Industrial 1234',
  localidad: 'Tigre',
  provincia: 'BA',
  actividad_principal: 'Fabricación de estructuras metálicas',
  cantidad_empleados: 80,
  distribucion_turno: 'doble',
  modalidad_operativa: 'industrial',
  art_contratada: 'La Segunda',
  servicio_hys_modalidad: 'externo',
  areas_relevadas: ['Oficinas administrativas', 'Producción / planta'],
  fecha_relevamiento: '2026-05-12',
};

describe('rgrl · personalizacion (T-138 fase 1)', () => {
  it('backward-compat: la fixture pre-T-138 parsea con los campos nuevos undefined', () => {
    const r = rgrlMetadataSchema.safeParse(validFixture);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.campos_personalizados).toBeUndefined();
    expect(r.data.instrucciones_adicionales).toBeUndefined();
  });

  it('acepta campos_personalizados + instrucciones_adicionales', () => {
    const r = rgrlMetadataSchema.safeParse({
      ...validFixture,
      campos_personalizados: [{ label: 'N° de contrato ART', valor: '887766' }],
      instrucciones_adicionales: 'priorizá el plan de mejoras por costo',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.campos_personalizados).toHaveLength(1);
  });

  it('rechaza campos_personalizados sobre el cap (10)', () => {
    const r = rgrlMetadataSchema.safeParse({
      ...validFixture,
      campos_personalizados: Array.from({ length: 11 }, () => ({ label: 'L', valor: 'v' })),
    });
    expect(r.success).toBe(false);
  });

  it("normalize: [] y '' de personalizacion → undefined (e idempotente)", () => {
    const n = normalizeRgrlMetadata({
      ...validFixture,
      campos_personalizados: [],
      instrucciones_adicionales: '',
    });
    expect(n.campos_personalizados).toBeUndefined();
    expect(n.instrucciones_adicionales).toBeUndefined();
    expect(normalizeRgrlMetadata(n)).toEqual(n);
  });

  it('render: bloques de personalizacion entre los datos y el footer de 10 secciones', () => {
    const out = renderRgrlMetadataAsPromptContext({
      ...validFixture,
      campos_personalizados: [{ label: 'N° de contrato ART', valor: '887766' }],
      instrucciones_adicionales: 'plan de mejoras por costo',
    });
    const camposIdx = out.indexOf('Campos personalizados');
    const instruccionesIdx = out.indexOf('Instrucciones adicionales del consultor');
    const footerIdx = out.indexOf('Generá el RGRL');
    expect(camposIdx).toBeGreaterThan(out.indexOf('**Relevamiento:**'));
    expect(instruccionesIdx).toBeGreaterThan(camposIdx);
    expect(footerIdx).toBeGreaterThan(instruccionesIdx);
    // La estructura legal NO cambia: el footer sigue pidiendo las 10 secciones.
    expect(out).toContain('estructura de 10 secciones');
  });

  it('render sin personalizacion: user message identico a pre-T-138 (sin bloques nuevos)', () => {
    const out = renderRgrlMetadataAsPromptContext(validFixture);
    expect(out).not.toContain('Campos personalizados');
    expect(out).not.toContain('Instrucciones adicionales del consultor');
  });
});
