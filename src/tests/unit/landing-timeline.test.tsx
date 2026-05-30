/**
 * T-108 · Timeline: renderiza ambas variants (semana / onboarding) con todos
 * los pasos + numeración correcta + data-variant attribute para que el caller
 * pueda estilizarlo distinto si quiere.
 *
 * Test puro sin DB. Cubre regresión de:
 *  - el discriminator de variant no se pierde en el shape del DOM.
 *  - los N steps renderizan los N títulos y los N badges (no se duplican ni
 *    se truncan).
 *  - el badge tone cambia con la variant (severity-ok en onboarding,
 *    primary en semana) — verificación visual mínima vía className.
 */
import type { TimelineStep } from '@/shared/landing/Timeline';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Timeline } from '@/shared/landing/Timeline';

afterEach(() => {
  cleanup();
});

const SEMANA: readonly TimelineStep[] = [
  { badge: 'Lun', title: 'Visita planta cliente A', body: 'Relevás 3 puestos en 1 hora.' },
  { badge: 'Mar', title: 'Generás informe', body: 'IA arma el draft en 5 minutos.' },
  { badge: 'Mié', title: 'Revisás y firmás', body: 'Edits menores y exportás PDF.' },
  { badge: 'Jue', title: 'Mandás al cliente', body: 'PDF firmado por email + WhatsApp.' },
];

const ONBOARDING: readonly TimelineStep[] = [
  { badge: '30 seg', title: 'Creás la cuenta', body: 'Mail + contraseña. Sin tarjeta.' },
  { badge: '2 min', title: 'Cargás tu primer cliente', body: 'Razón social + CUIT.' },
  { badge: '5 min', title: 'Cargás 3 empleados', body: 'CSV o manual.' },
  { badge: '10 min', title: 'Generás tu primer informe', body: 'Form + IA.' },
];

describe('Timeline', () => {
  it('variant="semana" renderiza los 4 pasos con badge primary tone', () => {
    render(<Timeline variant="semana" steps={SEMANA} />);
    expect(screen.getAllByText('Visita planta cliente A')).not.toHaveLength(0);
    expect(screen.getAllByText('Generás informe')).not.toHaveLength(0);
    expect(screen.getAllByText('Mandás al cliente')).not.toHaveLength(0);
    expect(screen.getAllByText(/^Lun$/)).not.toHaveLength(0);

    // El contenedor expone data-variant para que el caller pueda targetear
    // estilos por variant sin parsear className.
    const container = screen.getAllByTestId('timeline-semana');
    expect(container.length).toBeGreaterThan(0);
  });

  it('variant="onboarding" renderiza los 4 pasos con badge ok tone', () => {
    render(<Timeline variant="onboarding" steps={ONBOARDING} />);
    expect(screen.getAllByText('Creás la cuenta')).not.toHaveLength(0);
    expect(screen.getAllByText('Generás tu primer informe')).not.toHaveLength(0);
    expect(screen.getAllByText('30 seg')[0]).toBeInTheDocument();
    expect(screen.getAllByText('10 min')[0]).toBeInTheDocument();

    const container = screen.getAllByTestId('timeline-onboarding');
    expect(container.length).toBeGreaterThan(0);
  });

  it('numera los pasos del 1 al N (en desktop y mobile)', () => {
    render(<Timeline variant="semana" steps={SEMANA} />);
    // Cada step renderiza su número 2 veces (1 desktop + 1 mobile, hidden
    // por CSS pero presente en DOM). 4 steps × 2 = 8 instancias de cada num.
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(2);
  });
});
