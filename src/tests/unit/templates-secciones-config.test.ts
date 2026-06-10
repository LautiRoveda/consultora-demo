import type { SeccionConfig } from '@/shared/templates/common/secciones';
import { describe, expect, it } from 'vitest';

import {
  defaultSeccionesConfig,
  esSeleccionDefault,
  normalizeSecciones,
  SECCIONES_MAX_CUSTOM,
  SECCIONES_MAX_TOTAL,
  seccionesField,
} from '@/shared/templates/common/secciones';

/**
 * T-138 fase 2 · Factory Zod + helpers de la configuracion de secciones.
 * Los caps y el refine de dedup son la primera defensa (costo en tokens +
 * estructura coherente); `esSeleccionDefault`/`normalizeSecciones` sostienen
 * el contrato backward-compat "config default = jsonb sin el campo".
 */

const IDS = ['objeto', 'alcance', 'desarrollo'] as const;
const schema = seccionesField(IDS);

const catalogo = (id: (typeof IDS)[number]): SeccionConfig => ({
  kind: 'catalogo',
  seccion_id: id,
});
const custom = (titulo: string, descripcion?: string): SeccionConfig => ({
  kind: 'custom',
  titulo,
  descripcion,
});

describe('seccionesField', () => {
  it('es opcional: undefined parsea (metadata pre-fase-2)', () => {
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it('happy path: refs de catalogo + customs en cualquier orden', () => {
    const r = schema.safeParse([
      catalogo('desarrollo'),
      custom('Plan de izaje', 'Secuencia de izaje y señalero'),
      catalogo('objeto'),
    ]);
    expect(r.success).toBe(true);
  });

  it('rechaza seccion_id fuera del catalogo del tipo', () => {
    expect(schema.safeParse([{ kind: 'catalogo', seccion_id: 'inventada' }]).success).toBe(false);
  });

  it('rechaza array vacio (min 1)', () => {
    expect(schema.safeParse([]).success).toBe(false);
  });

  it('rechaza refs de catalogo duplicadas', () => {
    expect(schema.safeParse([catalogo('objeto'), catalogo('objeto')]).success).toBe(false);
  });

  it('rechaza titulo custom corto o largo', () => {
    expect(schema.safeParse([custom('ab')]).success).toBe(false);
    expect(schema.safeParse([custom('a'.repeat(81))]).success).toBe(false);
  });

  it(`caps: rechaza > ${SECCIONES_MAX_TOTAL} totales y > ${SECCIONES_MAX_CUSTOM} customs`, () => {
    const muchas = Array.from({ length: SECCIONES_MAX_TOTAL + 1 }, (_, i) =>
      custom(`Sección ${i + 1}`),
    );
    // 16 totales (todas custom) rompe el cap total ADEMAS del de customs.
    expect(schema.safeParse(muchas).success).toBe(false);

    const seisCustoms = [
      catalogo('objeto'),
      ...Array.from({ length: SECCIONES_MAX_CUSTOM + 1 }, (_, i) => custom(`Sección ${i + 1}`)),
    ];
    expect(schema.safeParse(seisCustoms).success).toBe(false);
  });
});

describe('defaultSeccionesConfig / esSeleccionDefault', () => {
  it('el default es el catalogo completo en orden canonico y matchea esSeleccionDefault', () => {
    const def = defaultSeccionesConfig(IDS);
    expect(def).toEqual([catalogo('objeto'), catalogo('alcance'), catalogo('desarrollo')]);
    expect(esSeleccionDefault(def, IDS)).toBe(true);
  });

  it('reorden, subset o custom NO son default', () => {
    expect(
      esSeleccionDefault([catalogo('alcance'), catalogo('objeto'), catalogo('desarrollo')], IDS),
    ).toBe(false);
    expect(esSeleccionDefault([catalogo('objeto'), catalogo('alcance')], IDS)).toBe(false);
    expect(esSeleccionDefault([...defaultSeccionesConfig(IDS), custom('Plan de izaje')], IDS)).toBe(
      false,
    );
  });
});

describe('normalizeSecciones', () => {
  it('default → undefined (jsonb lean, informe se comporta como pre-fase-2)', () => {
    expect(normalizeSecciones(defaultSeccionesConfig(IDS), IDS)).toBeUndefined();
    expect(normalizeSecciones(undefined, IDS)).toBeUndefined();
    expect(normalizeSecciones([], IDS)).toBeUndefined();
  });

  it("config no-default se preserva; descripcion '' de customs → undefined; idempotente", () => {
    const config: SeccionConfig<(typeof IDS)[number]>[] = [
      { kind: 'custom', titulo: 'Plan de izaje', descripcion: '' },
      catalogo('objeto') as SeccionConfig<(typeof IDS)[number]>,
    ];
    const n = normalizeSecciones(config, IDS);
    expect(n).toEqual([
      { kind: 'custom', titulo: 'Plan de izaje', descripcion: undefined },
      { kind: 'catalogo', seccion_id: 'objeto' },
    ]);
    expect(normalizeSecciones(n, IDS)).toEqual(n);
  });
});
