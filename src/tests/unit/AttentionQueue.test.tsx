/**
 * T-131 · Tests del componente AttentionQueue ("Lo que necesita tu atención").
 *
 * Reemplaza la cobertura del viejo ProximosVencimientosPanel (cola + empty
 * state). Cubre: empty state, badge semáforo ícono+texto, CTA drill-to-action
 * por tipo (pilar EPP vs "Ver en agenda"), tipo label + título.
 */
import type { CalendarEventRow } from '@/app/(app)/calendario/queries';
import type { AttentionEntry } from '@/app/(app)/dashboard/queries';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AttentionQueue } from '@/app/(app)/dashboard/AttentionQueue';

afterEach(cleanup);

function makeEvent(over: Partial<CalendarEventRow>): CalendarEventRow {
  return {
    id: 'evt',
    consultora_id: 'c1',
    tipo: 'custom',
    titulo: 'Evento',
    descripcion: null,
    informe_id: null,
    fecha_vencimiento: '2026-12-31',
    recurrence_months: null,
    status: 'pending',
    completed_at: null,
    completed_by: null,
    parent_event_id: null,
    reminder_offsets_days: [],
    metadata: null,
    created_by: 'u1',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

describe('AttentionQueue', () => {
  it('empty state: items vacíos → "Todo al día"', () => {
    render(<AttentionQueue items={[]} />);
    expect(screen.getByTestId('attention-queue-empty')).toBeInTheDocument();
    expect(screen.getByText(/Todo al día/i)).toBeInTheDocument();
  });

  it('overdue EPP → badge "Vencido" + CTA pilar a la planilla Res 299/11', () => {
    const items: AttentionEntry[] = [
      {
        ev: makeEvent({
          id: 'o1',
          tipo: 'epp_entrega',
          titulo: 'EPP del galpón',
          fecha_vencimiento: '2020-01-01',
        }),
        severity: 'overdue',
      },
    ];
    render(<AttentionQueue items={items} />);

    expect(screen.getByTestId('attention-item-o1')).toBeInTheDocument();
    expect(screen.getByText('Vencido')).toBeInTheDocument();
    expect(screen.getByText('EPP del galpón')).toBeInTheDocument();
    expect(screen.getByText(/Entrega de EPP/)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Generar planilla Res 299/11' });
    expect(cta).toHaveAttribute('href', '/epp/entregas/nueva');
  });

  it('upcoming custom → badge "Por vencer" + CTA "Ver en agenda" con deep-link', () => {
    const items: AttentionEntry[] = [
      { ev: makeEvent({ id: 'u1', tipo: 'custom', titulo: 'Algo' }), severity: 'upcoming' },
    ];
    render(<AttentionQueue items={items} />);

    expect(screen.getByText('Por vencer')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Ver en agenda' });
    expect(cta).toHaveAttribute('href', '/calendario/agenda?event=u1');
  });

  it('renderiza varios ítems con heading semántico real', () => {
    const items: AttentionEntry[] = [
      { ev: makeEvent({ id: 'a' }), severity: 'overdue' },
      { ev: makeEvent({ id: 'b' }), severity: 'upcoming' },
    ];
    render(<AttentionQueue items={items} />);
    expect(
      screen.getByRole('heading', { name: /Lo que necesita tu atención/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('attention-item-a')).toBeInTheDocument();
    expect(screen.getByTestId('attention-item-b')).toBeInTheDocument();
  });
});
