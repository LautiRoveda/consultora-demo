/**
 * T-060b · Unit tests del mapeo PURO respuesta "no cumple" → CAPA.
 */
import type { RespuestaForCapa } from '@/app/(app)/checklists/ejecuciones/acciones-capa';
import type { ItemForScore } from '@/app/(app)/checklists/ejecuciones/scoring';
import { describe, expect, it } from 'vitest';

import {
  buildCapaDescripcion,
  buildCapaRows,
  defaultFechaCompromiso,
} from '@/app/(app)/checklists/ejecuciones/acciones-capa';

function item(
  id: string,
  opts: { response_type?: string; es_critico?: boolean; texto?: string } = {},
): ItemForScore {
  return {
    id,
    response_type: opts.response_type ?? 'cumple_no_aplica',
    es_critico: opts.es_critico ?? false,
    es_requerido: true,
    texto: opts.texto ?? `Texto del ítem ${id}`,
  };
}

function resp(
  template_item_id: string,
  r: Partial<RespuestaForCapa> & { id: string },
): RespuestaForCapa {
  return {
    id: r.id,
    template_item_id,
    valor: r.valor ?? null,
    valor_numerico: r.valor_numerico ?? null,
    observacion: r.observacion ?? null,
    fecha_regularizacion: r.fecha_regularizacion ?? null,
  };
}

const CERRADA = '2026-06-03T12:00:00.000Z';

describe('defaultFechaCompromiso', () => {
  it('cerrada_at + 30 días (civil UTC)', () => {
    expect(defaultFechaCompromiso(CERRADA)).toBe('2026-07-03');
  });
  it('respeta plazo custom', () => {
    expect(defaultFechaCompromiso(CERRADA, 7)).toBe('2026-06-10');
  });
});

describe('buildCapaDescripcion', () => {
  it('texto + observacion', () => {
    expect(buildCapaDescripcion('Falta matafuego', 'En sector B')).toBe(
      'Falta matafuego — En sector B',
    );
  });
  it('sin observacion = solo texto', () => {
    expect(buildCapaDescripcion('Falta matafuego', null)).toBe('Falta matafuego');
  });
  it('guard si el texto base es <3 chars (CHECK descripcion >= 3)', () => {
    expect(buildCapaDescripcion('X', null).length).toBeGreaterThanOrEqual(3);
    expect(buildCapaDescripcion('X', null)).toBe('Hallazgo: X');
  });
  it('clamp a 2000 chars', () => {
    expect(buildCapaDescripcion('x'.repeat(3000), null).length).toBe(2000);
  });
});

describe('buildCapaRows', () => {
  it('1 CAPA por cumple_no_aplica="no"; prioridad alta si crítico; fecha del hallazgo', () => {
    const items = [
      item('a', { es_critico: false, texto: 'Ítem A' }),
      item('b', { es_critico: true, texto: 'Ítem B' }),
    ];
    const respuestas = [
      resp('a', {
        id: 'r-a',
        valor: 'no',
        observacion: 'obs A',
        fecha_regularizacion: '2026-09-01',
      }),
      resp('b', { id: 'r-b', valor: 'no' }), // sin fecha → default +30d
    ];
    const rows = buildCapaRows(items, respuestas, CERRADA);
    expect(rows).toHaveLength(2);

    const a = rows.find((r) => r.respuesta_id === 'r-a')!;
    expect(a).toMatchObject({
      prioridad: 'media',
      fecha_compromiso: '2026-09-01',
      descripcion: 'Ítem A — obs A',
    });

    const b = rows.find((r) => r.respuesta_id === 'r-b')!;
    expect(b).toMatchObject({
      prioridad: 'alta',
      fecha_compromiso: '2026-07-03',
      descripcion: 'Ítem B',
    });
  });

  it('ignora cumple/na y otros response_type (solo no-cumple genera CAPA)', () => {
    const items = [
      item('a', { texto: 'cumple' }),
      item('b', { texto: 'na' }),
      item('c', { response_type: 'si_no', texto: 'si_no no' }),
      item('d', { response_type: 'texto', texto: 'texto' }),
      item('e', { texto: 'no cumple' }),
    ];
    const respuestas = [
      resp('a', { id: 'r-a', valor: 'si' }),
      resp('b', { id: 'r-b', valor: 'na' }),
      resp('c', { id: 'r-c', valor: 'no' }), // si_no='no' NO genera CAPA
      resp('d', { id: 'r-d', valor: 'algo' }),
      resp('e', { id: 'r-e', valor: 'no' }),
    ];
    const rows = buildCapaRows(items, respuestas, CERRADA);
    expect(rows.map((r) => r.respuesta_id)).toEqual(['r-e']);
  });

  it('respuesta sin ítem conocido se ignora', () => {
    const rows = buildCapaRows([item('a')], [resp('zzz', { id: 'r-z', valor: 'no' })], CERRADA);
    expect(rows).toHaveLength(0);
  });
});
