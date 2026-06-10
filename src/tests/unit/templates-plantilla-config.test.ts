import type { PlantillaConfig } from '@/shared/templates/registry/plantilla-config';
import { describe, expect, it } from 'vitest';

import { SECCION_IDS_CAPACITACION } from '@/shared/templates/capacitacion/secciones';
import { CAMPOS_PERSONALIZADOS_MAX } from '@/shared/templates/common/campos-extra';
import {
  degradePlantillaConfig,
  isPlantillaConfigVacia,
  normalizePlantillaConfig,
  PLANTILLA_CONFIG_SCHEMA_BY_TIPO,
} from '@/shared/templates/registry/plantilla-config';
import { SECCION_IDS_RELEVAMIENTO } from '@/shared/templates/relevamiento/secciones';

/**
 * T-139 · Config de plantillas: validacion strict per-tipo (la config es
 * estructura, nunca datos del cliente) + degrade al aplicar (plantilla vieja
 * filtra/recorta, no rompe).
 */

const relevamiento = PLANTILLA_CONFIG_SCHEMA_BY_TIPO.relevamiento;
const rgrl = PLANTILLA_CONFIG_SCHEMA_BY_TIPO.rgrl;

const configValida: PlantillaConfig = {
  campos_personalizados: [{ label: 'Expediente', valor: 'EXP-2026-001' }],
  instrucciones_adicionales: 'Tono formal, citar Res 85/2012.',
  secciones: [
    { kind: 'catalogo', seccion_id: 'mediciones' },
    { kind: 'custom', titulo: 'Plan de adecuación', descripcion: 'Plazos por puesto' },
  ],
};

describe('PLANTILLA_CONFIG_SCHEMA_BY_TIPO', () => {
  it('happy path: config de personalizacion completa parsea (relevamiento)', () => {
    expect(relevamiento.safeParse(configValida).success).toBe(true);
  });

  it('strict: rechaza datos del cliente (keys por-informe, no de la plantilla)', () => {
    const conDatos = { ...configValida, razon_social: 'Acme SA', cuit: '30-12345678-9' };
    expect(relevamiento.safeParse(conDatos).success).toBe(false);
  });

  it('rechaza secciones de OTRO tipo (id de capacitacion en relevamiento)', () => {
    const cruzada = {
      secciones: [{ kind: 'catalogo', seccion_id: SECCION_IDS_CAPACITACION[0] }],
    };
    // Guard del fixture: el id realmente no pertenece al catalogo de relevamiento.
    expect(SECCION_IDS_RELEVAMIENTO).not.toContain(SECCION_IDS_CAPACITACION[0]);
    expect(relevamiento.safeParse(cruzada).success).toBe(false);
  });

  it('rechaza secciones en tipos de estructura legal fija (rgrl/accidente)', () => {
    const conSecciones = {
      instrucciones_adicionales: 'x',
      secciones: [{ kind: 'custom', titulo: 'Sección extra' }],
    };
    expect(rgrl.safeParse(conSecciones).success).toBe(false);
    expect(PLANTILLA_CONFIG_SCHEMA_BY_TIPO.accidente.safeParse(conSecciones).success).toBe(false);
  });

  it('rechaza over-cap (campos > max)', () => {
    const overCap = {
      campos_personalizados: Array.from({ length: CAMPOS_PERSONALIZADOS_MAX + 1 }, (_, i) => ({
        label: `Campo ${i + 1}`,
        valor: 'v',
      })),
    };
    expect(relevamiento.safeParse(overCap).success).toBe(false);
  });

  it('config vacia ({}) parsea: el rechazo de "plantilla vacia" es post-normalize', () => {
    expect(relevamiento.safeParse({}).success).toBe(true);
    expect(isPlantillaConfigVacia({})).toBe(true);
  });
});

describe('normalizePlantillaConfig / isPlantillaConfigVacia', () => {
  it('seleccion default de secciones normaliza a vacia (aplicarla seria no-op)', () => {
    const soloDefault: PlantillaConfig = {
      secciones: SECCION_IDS_RELEVAMIENTO.map((id) => ({ kind: 'catalogo', seccion_id: id })),
    };
    const normalized = normalizePlantillaConfig('relevamiento', soloDefault);
    expect(normalized.secciones).toBeUndefined();
    expect(isPlantillaConfigVacia(normalized)).toBe(true);
  });

  it('config con contenido real sobrevive el normalize', () => {
    const normalized = normalizePlantillaConfig('relevamiento', configValida);
    expect(isPlantillaConfigVacia(normalized)).toBe(false);
    expect(normalized.campos_personalizados).toHaveLength(1);
    expect(normalized.secciones).toHaveLength(2);
  });
});

describe('degradePlantillaConfig', () => {
  it('config valida pasa intacta (degradado: false)', () => {
    const r = degradePlantillaConfig('relevamiento', configValida);
    expect(r).toMatchObject({ ok: true, degradado: false });
    if (r.ok) expect(r.config.secciones).toHaveLength(2);
  });

  it('filtra seccion_id que ya no existe en el catalogo y conserva el resto', () => {
    const vieja = {
      instrucciones_adicionales: 'Tono formal.',
      secciones: [
        { kind: 'catalogo', seccion_id: 'seccion_eliminada_del_catalogo' },
        { kind: 'catalogo', seccion_id: 'mediciones' },
      ],
    };
    const r = degradePlantillaConfig('relevamiento', vieja);
    expect(r).toMatchObject({ ok: true, degradado: true });
    if (r.ok) {
      expect(r.config.secciones).toEqual([{ kind: 'catalogo', seccion_id: 'mediciones' }]);
      expect(r.config.instrucciones_adicionales).toBe('Tono formal.');
    }
  });

  it('dedupea refs de catalogo repetidas y filtra campos malformados', () => {
    const rota = {
      campos_personalizados: [
        { label: 'Expediente', valor: 'EXP-1' },
        { label: '', valor: 'sin label' },
      ],
      secciones: [
        { kind: 'catalogo', seccion_id: 'mediciones' },
        { kind: 'catalogo', seccion_id: 'mediciones' },
      ],
    };
    const r = degradePlantillaConfig('relevamiento', rota);
    expect(r).toMatchObject({ ok: true, degradado: true });
    if (r.ok) {
      expect(r.config.campos_personalizados).toEqual([{ label: 'Expediente', valor: 'EXP-1' }]);
      expect(r.config.secciones).toHaveLength(1);
    }
  });

  it('recorta instrucciones over-cap en vez de rechazar', () => {
    const r = degradePlantillaConfig('rgrl', { instrucciones_adicionales: 'x'.repeat(2000) });
    expect(r).toMatchObject({ ok: true, degradado: true });
    if (r.ok) expect(r.config.instrucciones_adicionales).toHaveLength(1500);
  });

  it('insalvable → ok: false (raw no-objeto / nada valido tras filtrar)', () => {
    expect(degradePlantillaConfig('relevamiento', null).ok).toBe(false);
    expect(degradePlantillaConfig('relevamiento', 'texto').ok).toBe(false);
    expect(
      degradePlantillaConfig('relevamiento', {
        secciones: [{ kind: 'catalogo', seccion_id: 'ya_no_existe' }],
      }).ok,
    ).toBe(false);
  });

  it('secciones en tipo fijo (rgrl) se descartan; el resto de la config sobrevive', () => {
    const r = degradePlantillaConfig('rgrl', {
      instrucciones_adicionales: 'Citar Dec 351/79.',
      secciones: [{ kind: 'custom', titulo: 'Sección inválida acá' }],
    });
    expect(r).toMatchObject({ ok: true, degradado: true });
    if (r.ok) {
      expect(r.config.secciones).toBeUndefined();
      expect(r.config.instrucciones_adicionales).toBe('Citar Dec 351/79.');
    }
  });
});
