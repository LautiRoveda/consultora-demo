/**
 * T-131 · Tests del componente DashboardCounters (banda de 4 contadores).
 *
 * Cubre: data-count exacto, hrefs a la lista existente (fase A), texto accesible
 * (número + label) y el resalte rojo (acción requerida) solo cuando aplica.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DashboardCounters } from '@/app/(app)/dashboard/DashboardCounters';

afterEach(cleanup);

const METRICS = { vencenSemana: 3, vencidos: 2, borradores: 5, accionesAbiertas: 1 };

describe('DashboardCounters', () => {
  it('renderiza los 4 contadores con data-count y href correctos', () => {
    render(<DashboardCounters metrics={METRICS} />);

    const semana = screen.getByTestId('counter-vencen-semana');
    expect(semana).toHaveAttribute('data-count', '3');
    expect(semana).toHaveAttribute('href', '/calendario/agenda');

    const vencidos = screen.getByTestId('counter-vencidos');
    expect(vencidos).toHaveAttribute('data-count', '2');
    expect(vencidos).toHaveAttribute('href', '/calendario/agenda');

    const borradores = screen.getByTestId('counter-borradores');
    expect(borradores).toHaveAttribute('data-count', '5');
    expect(borradores).toHaveAttribute('href', '/informes');

    const capas = screen.getByTestId('counter-capas');
    expect(capas).toHaveAttribute('data-count', '1');
    expect(capas).toHaveAttribute('href', '/checklists/ejecuciones');
  });

  it('nombre accesible: incluye número + label', () => {
    render(<DashboardCounters metrics={METRICS} />);
    expect(screen.getByTestId('counter-vencidos')).toHaveTextContent('2');
    expect(screen.getByTestId('counter-vencidos')).toHaveTextContent('Vencidos');
  });

  it('resalta en rojo solo los contadores con acción requerida (> 0)', () => {
    render(
      <DashboardCounters
        metrics={{ vencenSemana: 0, vencidos: 4, borradores: 0, accionesAbiertas: 0 }}
      />,
    );
    // Vencidos > 0 → resalte destructivo.
    expect(screen.getByTestId('counter-vencidos').className).toContain('border-destructive');
    // Vencen esta semana = 0 → sin resalte.
    expect(screen.getByTestId('counter-vencen-semana').className).not.toContain(
      'border-destructive',
    );
    // Borradores nunca resalta (neutro), aunque tenga valor en otros casos.
    expect(screen.getByTestId('counter-borradores').className).not.toContain('border-destructive');
  });
});
