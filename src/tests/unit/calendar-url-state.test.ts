/**
 * T-029 · Tests del parser/builder de searchParams del calendario.
 *
 * Cobertura:
 *  - parseUrlState: defaults, malformados, intersect con enums, dedup, UUID gate.
 *  - buildSearchParams: omite defaults para URL canonica.
 *  - addMonthsToYM cross-anio.
 *  - monthBoundsIso edge cases (febrero bisiesto + diciembre).
 */
import { describe, expect, it } from 'vitest';

import {
  addMonthsToYM,
  buildSearchParams,
  formatYM,
  monthBoundsIso,
  parseUrlState,
} from '@/app/(app)/calendario/url-state';

describe('parseUrlState', () => {
  it('searchParams vacios → mes actual UTC + status default + sin tipos/event', () => {
    const result = parseUrlState({});
    const now = new Date();
    expect(result.year).toBe(now.getUTCFullYear());
    expect(result.month).toBe(now.getUTCMonth() + 1);
    expect(result.status).toEqual(['pending']);
    expect(result.tipo).toEqual([]);
    expect(result.event).toBeNull();
  });

  it('month=2026-06 → year=2026, month=6', () => {
    const r = parseUrlState({ month: '2026-06' });
    expect(r.year).toBe(2026);
    expect(r.month).toBe(6);
  });

  it('month=invalid (formato) → fallback al actual', () => {
    const r = parseUrlState({ month: '2026/06' });
    const now = new Date();
    expect(r.year).toBe(now.getUTCFullYear());
    expect(r.month).toBe(now.getUTCMonth() + 1);
  });

  it('month=2026-13 (mes fuera de rango) → fallback', () => {
    const r = parseUrlState({ month: '2026-13' });
    expect(r.month).not.toBe(13);
  });

  it('tipo=rgrl_anual,epp_entrega → array de 2 valores validos', () => {
    const r = parseUrlState({ tipo: 'rgrl_anual,epp_entrega' });
    expect(r.tipo).toEqual(['rgrl_anual', 'epp_entrega']);
  });

  it('tipo con valor invalido lo filtra silenciosamente', () => {
    const r = parseUrlState({ tipo: 'rgrl_anual,fake_tipo,custom' });
    expect(r.tipo).toEqual(['rgrl_anual', 'custom']);
  });

  it('tipo con duplicados los dedupea', () => {
    const r = parseUrlState({ tipo: 'rgrl_anual,rgrl_anual,custom' });
    expect(r.tipo).toEqual(['rgrl_anual', 'custom']);
  });

  it('status=pending,completed → array de 2', () => {
    const r = parseUrlState({ status: 'pending,completed' });
    expect(r.status).toEqual(['pending', 'completed']);
  });

  it('status vacio o todos invalidos → cae al default ["pending"]', () => {
    expect(parseUrlState({ status: '' }).status).toEqual(['pending']);
    expect(parseUrlState({ status: 'fake1,fake2' }).status).toEqual(['pending']);
  });

  it('event con UUID valido lo retorna; UUID invalido cae a null', () => {
    const validUuid = '00000000-0000-4000-8000-000000000001';
    expect(parseUrlState({ event: validUuid }).event).toBe(validUuid);
    expect(parseUrlState({ event: 'not-a-uuid' }).event).toBeNull();
    expect(parseUrlState({ event: '00000000-0000-4000-8000-00000000000G' }).event).toBeNull();
  });

  it('acepta URLSearchParams real (cliente)', () => {
    const sp = new URLSearchParams('month=2027-01&tipo=custom&status=cancelled');
    const r = parseUrlState(sp);
    expect(r.year).toBe(2027);
    expect(r.month).toBe(1);
    expect(r.tipo).toEqual(['custom']);
    expect(r.status).toEqual(['cancelled']);
  });

  it('valor multiple en searchParams Next (string[]) → toma el primero', () => {
    const r = parseUrlState({ tipo: ['rgrl_anual', 'should-be-ignored'] });
    expect(r.tipo).toEqual(['rgrl_anual']);
  });
});

describe('buildSearchParams', () => {
  it('estado matching defaults → string vacio (URL canonica)', () => {
    const now = new Date();
    expect(
      buildSearchParams({
        year: now.getUTCFullYear(),
        month: now.getUTCMonth() + 1,
        status: ['pending'],
        tipo: [],
        event: null,
      }),
    ).toBe('');
  });

  it('mes diferente → emite ?month=YYYY-MM', () => {
    const r = buildSearchParams({ year: 2027, month: 3 });
    expect(r).toBe('month=2027-03');
  });

  it('tipo no-vacio → emite ?tipo=a,b', () => {
    const r = buildSearchParams({ tipo: ['rgrl_anual', 'custom'] });
    expect(r).toBe('tipo=rgrl_anual%2Ccustom');
  });

  it('status diferente al default → emite ?status=...', () => {
    const r = buildSearchParams({ status: ['completed'] });
    expect(r).toBe('status=completed');
  });

  it('event uuid → emite ?event=<uuid>', () => {
    const r = buildSearchParams({ event: '00000000-0000-4000-8000-000000000001' });
    expect(r).toBe('event=00000000-0000-4000-8000-000000000001');
  });

  it('event=null o undefined → omite el key', () => {
    expect(buildSearchParams({ event: null })).toBe('');
    expect(buildSearchParams({ event: undefined })).toBe('');
  });
});

describe('addMonthsToYM', () => {
  it('avanza dentro del mismo anio', () => {
    expect(addMonthsToYM({ year: 2026, month: 3 }, 2)).toEqual({ year: 2026, month: 5 });
  });

  it('cross-anio adelante: diciembre + 1 → enero anio siguiente', () => {
    expect(addMonthsToYM({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('cross-anio atras: enero - 1 → diciembre anio anterior', () => {
    expect(addMonthsToYM({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('delta grande: + 24 meses', () => {
    expect(addMonthsToYM({ year: 2026, month: 6 }, 24)).toEqual({ year: 2028, month: 6 });
  });
});

describe('formatYM + monthBoundsIso', () => {
  it('formatYM padea mes con cero', () => {
    expect(formatYM({ year: 2026, month: 3 })).toBe('2026-03');
    expect(formatYM({ year: 2026, month: 12 })).toBe('2026-12');
  });

  it('monthBoundsIso febrero NO bisiesto → 28 dias', () => {
    expect(monthBoundsIso(2026, 2)).toEqual(['2026-02-01', '2026-02-28']);
  });

  it('monthBoundsIso febrero bisiesto → 29 dias', () => {
    expect(monthBoundsIso(2028, 2)).toEqual(['2028-02-01', '2028-02-29']);
  });

  it('monthBoundsIso diciembre → 31 dias', () => {
    expect(monthBoundsIso(2026, 12)).toEqual(['2026-12-01', '2026-12-31']);
  });
});
