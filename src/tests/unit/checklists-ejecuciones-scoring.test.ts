/**
 * T-060a · Unit tests de la lógica PURA de ejecución de inspecciones:
 *  - scoring (cumple/no_cumple/na, denominador 0, críticos, tipos ignorados),
 *  - detección de "no cumple" (solo cumple_no_aplica='no'),
 *  - completitud (es_requerido sin responder),
 *  - hash canónico determinístico (firma_pdf_hash),
 *  - schemas Zod (discriminated union por response_type).
 */
import type { FirmaHashInput } from '@/app/(app)/checklists/ejecuciones/hash';
import type { ItemForScore, RespuestaForScore } from '@/app/(app)/checklists/ejecuciones/scoring';
import { describe, expect, it } from 'vitest';

import { computeFirmaPdfHash } from '@/app/(app)/checklists/ejecuciones/hash';
import {
  cerrarEjecucionSchema,
  createEjecucionSchema,
  saveRespuestaSchema,
} from '@/app/(app)/checklists/ejecuciones/schema';
import {
  computeScore,
  findUnansweredRequired,
  isAnswered,
  isNoCumple,
  respuestasByItem,
} from '@/app/(app)/checklists/ejecuciones/scoring';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const UUID2 = '123e4567-e89b-42d3-a456-426614174001';

function item(
  id: string,
  response_type: string,
  opts: { es_critico?: boolean; es_requerido?: boolean } = {},
): ItemForScore {
  return {
    id,
    response_type,
    es_critico: opts.es_critico ?? false,
    es_requerido: opts.es_requerido ?? true,
    texto: `Item ${id}`,
  };
}

function resp(
  template_item_id: string,
  r: Partial<RespuestaForScore>,
): RespuestaForScore & { template_item_id: string } {
  return { template_item_id, valor: r.valor ?? null, valor_numerico: r.valor_numerico ?? null };
}

// ============================== computeScore ==============================

describe('computeScore', () => {
  it('cuenta cumple/no_cumple/na y calcula pct (N-A excluido del denominador)', () => {
    const items = [
      item('a', 'cumple_no_aplica'),
      item('b', 'cumple_no_aplica'),
      item('c', 'cumple_no_aplica'),
      item('d', 'cumple_no_aplica'),
    ];
    const byItem = respuestasByItem([
      resp('a', { valor: 'si' }),
      resp('b', { valor: 'si' }),
      resp('c', { valor: 'no' }),
      resp('d', { valor: 'na' }),
    ]);
    const s = computeScore(items, byItem);
    expect(s).toMatchObject({ score_cumple: 2, score_no_cumple: 1, score_na: 1 });
    // 2 / (2+1) = 66.666… → 66.67
    expect(s.cumplimiento_pct).toBe(66.67);
    expect(s.tiene_criticos_incumplidos).toBe(false);
  });

  it('denominador 0 (solo N-A o sin responder) → cumplimiento_pct NULL', () => {
    const items = [item('a', 'cumple_no_aplica'), item('b', 'cumple_no_aplica')];
    const byItem = respuestasByItem([resp('a', { valor: 'na' })]); // b sin responder
    const s = computeScore(items, byItem);
    expect(s.cumplimiento_pct).toBeNull();
    expect(s).toMatchObject({ score_cumple: 0, score_no_cumple: 0, score_na: 1 });
  });

  it('crítico incumplido (es_critico + valor=no) → tiene_criticos_incumplidos true', () => {
    const items = [item('a', 'cumple_no_aplica', { es_critico: true })];
    const byItem = respuestasByItem([resp('a', { valor: 'no' })]);
    expect(computeScore(items, byItem).tiene_criticos_incumplidos).toBe(true);
  });

  it('crítico que CUMPLE no marca tiene_criticos_incumplidos', () => {
    const items = [item('a', 'cumple_no_aplica', { es_critico: true })];
    const byItem = respuestasByItem([resp('a', { valor: 'si' })]);
    expect(computeScore(items, byItem).tiene_criticos_incumplidos).toBe(false);
  });

  it('ignora response_type no-cumple_no_aplica (si_no/texto/numerico no puntúan)', () => {
    const items = [
      item('a', 'si_no'),
      item('b', 'texto'),
      item('c', 'numerico'),
      item('d', 'cumple_no_aplica'),
    ];
    const byItem = respuestasByItem([
      resp('a', { valor: 'no' }),
      resp('b', { valor: 'texto libre' }),
      resp('c', { valor_numerico: 42 }),
      resp('d', { valor: 'si' }),
    ]);
    const s = computeScore(items, byItem);
    expect(s).toMatchObject({ score_cumple: 1, score_no_cumple: 0, score_na: 0 });
    expect(s.cumplimiento_pct).toBe(100);
  });
});

// ============================== isNoCumple ==============================

describe('isNoCumple', () => {
  it('cumple_no_aplica + valor=no → true', () => {
    expect(isNoCumple(item('a', 'cumple_no_aplica'), { valor: 'no', valor_numerico: null })).toBe(
      true,
    );
  });
  it('cumple_no_aplica + valor=si/na → false', () => {
    expect(isNoCumple(item('a', 'cumple_no_aplica'), { valor: 'si', valor_numerico: null })).toBe(
      false,
    );
    expect(isNoCumple(item('a', 'cumple_no_aplica'), { valor: 'na', valor_numerico: null })).toBe(
      false,
    );
  });
  it('si_no + valor=no → false (informativo, NO genera CAPA)', () => {
    expect(isNoCumple(item('a', 'si_no'), { valor: 'no', valor_numerico: null })).toBe(false);
  });
  it('sin respuesta → false', () => {
    expect(isNoCumple(item('a', 'cumple_no_aplica'), undefined)).toBe(false);
  });
});

// ============================== findUnansweredRequired ==============================

describe('findUnansweredRequired', () => {
  it('lista los es_requerido sin responder; ignora opcionales y respondidos', () => {
    const items = [
      item('req-missing', 'cumple_no_aplica', { es_requerido: true }),
      item('req-answered', 'cumple_no_aplica', { es_requerido: true }),
      item('opt-missing', 'cumple_no_aplica', { es_requerido: false }),
    ];
    const byItem = respuestasByItem([resp('req-answered', { valor: 'si' })]);
    const missing = findUnansweredRequired(items, byItem);
    expect(missing.map((m) => m.id)).toEqual(['req-missing']);
  });

  it('texto con solo espacios cuenta como sin responder', () => {
    const items = [item('t', 'texto', { es_requerido: true })];
    const byItem = respuestasByItem([resp('t', { valor: '   ' })]);
    expect(findUnansweredRequired(items, byItem).map((m) => m.id)).toEqual(['t']);
  });

  it('numerico con valor_numerico=0 cuenta como respondido', () => {
    const items = [item('n', 'numerico', { es_requerido: true })];
    const byItem = respuestasByItem([resp('n', { valor_numerico: 0 })]);
    expect(findUnansweredRequired(items, byItem)).toEqual([]);
  });

  it('isAnswered: numerico null → false, cumple_no_aplica vacío → false', () => {
    expect(isAnswered(item('n', 'numerico'), { valor: null, valor_numerico: null })).toBe(false);
    expect(isAnswered(item('c', 'cumple_no_aplica'), { valor: '', valor_numerico: null })).toBe(
      false,
    );
    expect(isAnswered(item('c', 'cumple_no_aplica'), { valor: 'na', valor_numerico: null })).toBe(
      true,
    );
  });
});

// ============================== computeFirmaPdfHash ==============================

describe('computeFirmaPdfHash', () => {
  const base: FirmaHashInput = {
    execution_id: UUID,
    template_version_id: UUID2,
    cliente_id: UUID,
    score_cumple: 2,
    score_no_cumple: 1,
    score_na: 0,
    cumplimiento_pct: 66.67,
    tiene_criticos_incumplidos: true,
    cerrada_at: '2026-06-03T12:00:00.000Z',
    firmante_nombre: 'Ing. Pérez',
    firmante_matricula: 'MP-1234',
    firma_storage_path: `${UUID}/${UUID}.png`,
    respuestas: [
      {
        template_item_id: 'b',
        valor: 'no',
        valor_numerico: null,
        observacion: null,
        fecha_regularizacion: '2026-07-01',
      },
      {
        template_item_id: 'a',
        valor: 'si',
        valor_numerico: null,
        observacion: 'ok',
        fecha_regularizacion: null,
      },
    ],
  };

  it('produce 64 hex chars lowercase (match del CHECK SQL)', () => {
    expect(computeFirmaPdfHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('es determinístico: el orden de las respuestas NO cambia el hash', () => {
    const reordered: FirmaHashInput = { ...base, respuestas: [...base.respuestas].reverse() };
    expect(computeFirmaPdfHash(reordered)).toBe(computeFirmaPdfHash(base));
  });

  it('cambiar una respuesta cambia el hash (tamper-evidence)', () => {
    const tampered: FirmaHashInput = {
      ...base,
      respuestas: base.respuestas.map((r) =>
        r.template_item_id === 'b' ? { ...r, valor: 'si' } : r,
      ),
    };
    expect(computeFirmaPdfHash(tampered)).not.toBe(computeFirmaPdfHash(base));
  });

  it('cambiar la metadata de cierre (cerrada_at) cambia el hash', () => {
    expect(computeFirmaPdfHash({ ...base, cerrada_at: '2026-06-03T12:00:01.000Z' })).not.toBe(
      computeFirmaPdfHash(base),
    );
  });
});

// ============================== Schemas Zod ==============================

describe('saveRespuestaSchema (discriminated union por response_type)', () => {
  const baseIds = { executionId: UUID, templateItemId: UUID2 };

  it('cumple_no_aplica acepta si/no/na + fecha_regularizacion', () => {
    const r = saveRespuestaSchema.safeParse({
      ...baseIds,
      response_type: 'cumple_no_aplica',
      valor: 'no',
      fecha_regularizacion: '2026-07-01',
    });
    expect(r.success).toBe(true);
  });

  it('cumple_no_aplica rechaza valor fuera de {si,no,na}', () => {
    const r = saveRespuestaSchema.safeParse({
      ...baseIds,
      response_type: 'cumple_no_aplica',
      valor: 'maybe',
    });
    expect(r.success).toBe(false);
  });

  it('cumple_no_aplica acepta valor null (limpiar respuesta)', () => {
    const r = saveRespuestaSchema.safeParse({
      ...baseIds,
      response_type: 'cumple_no_aplica',
      valor: null,
    });
    expect(r.success).toBe(true);
  });

  it('si_no rechaza "na"', () => {
    const r = saveRespuestaSchema.safeParse({ ...baseIds, response_type: 'si_no', valor: 'na' });
    expect(r.success).toBe(false);
  });

  it('numerico requiere number (no string)', () => {
    expect(
      saveRespuestaSchema.safeParse({ ...baseIds, response_type: 'numerico', valor_numerico: 12.5 })
        .success,
    ).toBe(true);
    expect(
      saveRespuestaSchema.safeParse({ ...baseIds, response_type: 'numerico', valor_numerico: '12' })
        .success,
    ).toBe(false);
  });

  it('fecha_regularizacion con formato inválido → rechazada', () => {
    const r = saveRespuestaSchema.safeParse({
      ...baseIds,
      response_type: 'cumple_no_aplica',
      valor: 'no',
      fecha_regularizacion: '01/07/2026',
    });
    expect(r.success).toBe(false);
  });
});

describe('cerrarEjecucionSchema', () => {
  it('exige prefix data:image/png y firmante_nombre', () => {
    const ok = cerrarEjecucionSchema.safeParse({
      executionId: UUID,
      firma_base64: 'data:image/png;base64,iVBORw0KGgo=',
      firmante_nombre: 'Ing. Pérez',
      firmante_matricula: 'MP-1',
    });
    expect(ok.success).toBe(true);
  });

  it('rechaza firma con prefix no-PNG', () => {
    const r = cerrarEjecucionSchema.safeParse({
      executionId: UUID,
      firma_base64: 'data:image/jpeg;base64,XXXX',
      firmante_nombre: 'X',
    });
    expect(r.success).toBe(false);
  });

  it('rechaza firmante_nombre vacío', () => {
    const r = cerrarEjecucionSchema.safeParse({
      executionId: UUID,
      firma_base64: 'data:image/png;base64,iVBORw0KGgo=',
      firmante_nombre: '   ',
    });
    expect(r.success).toBe(false);
  });

  it('gps fuera de rango → rechazado', () => {
    const r = cerrarEjecucionSchema.safeParse({
      executionId: UUID,
      firma_base64: 'data:image/png;base64,iVBORw0KGgo=',
      firmante_nombre: 'X',
      gps_lat: 200,
    });
    expect(r.success).toBe(false);
  });
});

describe('createEjecucionSchema', () => {
  it('requiere templateId + clienteId UUID', () => {
    expect(createEjecucionSchema.safeParse({ templateId: UUID, clienteId: UUID2 }).success).toBe(
      true,
    );
    expect(
      createEjecucionSchema.safeParse({ templateId: 'no-uuid', clienteId: UUID2 }).success,
    ).toBe(false);
  });
});
