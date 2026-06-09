/**
 * T-131 · Tests de buildPulseLine (línea de pulso del dashboard).
 *
 * Cubre pluralización ES singular/plural por campo + el caso all-zero (mensaje
 * positivo, no "0 vencen esta semana · 0 informes...").
 */
import { describe, expect, it } from 'vitest';

import { buildPulseLine } from '@/app/(app)/dashboard/format';

describe('buildPulseLine', () => {
  it('all-zero → mensaje positivo, sin ceros', () => {
    expect(buildPulseLine({ vencidos: 0, vencenSemana: 0, borradores: 0 })).toBe(
      'Todo al día, sin pendientes inmediatos.',
    );
  });

  it('singular: 1 de cada uno', () => {
    expect(buildPulseLine({ vencidos: 1, vencenSemana: 1, borradores: 1 })).toBe(
      '1 vencido · 1 vence esta semana · 1 informe a medias',
    );
  });

  it('plural: N de cada uno', () => {
    expect(buildPulseLine({ vencidos: 3, vencenSemana: 5, borradores: 2 })).toBe(
      '3 vencidos · 5 vencen esta semana · 2 informes a medias',
    );
  });

  it('omite los campos en cero (solo muestra lo accionable)', () => {
    expect(buildPulseLine({ vencidos: 0, vencenSemana: 2, borradores: 0 })).toBe(
      '2 vencen esta semana',
    );
  });

  it('combina solo los campos con valor', () => {
    expect(buildPulseLine({ vencidos: 4, vencenSemana: 0, borradores: 1 })).toBe(
      '4 vencidos · 1 informe a medias',
    );
  });
});
