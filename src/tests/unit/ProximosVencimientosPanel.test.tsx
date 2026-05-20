/**
 * T-030 · Tests del ProximosVencimientosPanel (server async component).
 *
 * Estrategia: mockeamos createClient + queries → invocamos el component async
 * para resolver la promise → render del JSX retornado → assertions.
 */
import type { CalendarEventRow } from '@/app/(app)/calendario/queries';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProximosVencimientosPanel } from '@/app/(app)/dashboard/ProximosVencimientosPanel';

vi.mock('server-only', () => ({}));

const authGetUserMock = vi.fn();
vi.mock('@/shared/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: authGetUserMock },
    }),
}));

const getUpcomingMock = vi.fn<() => Promise<CalendarEventRow[]>>();
const getOverdueMock = vi.fn<() => Promise<CalendarEventRow[]>>();
vi.mock('@/app/(app)/calendario/queries', () => ({
  getUpcomingEvents: () => getUpcomingMock(),
  getOverdueEvents: () => getOverdueMock(),
}));

const OWNER_ID = '00000000-0000-4000-8000-00000000aaaa';
const CONS_ID = '00000000-0000-4000-8000-000000000aaa';

function makeEvent(overrides: Partial<CalendarEventRow>): CalendarEventRow {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-000000000001',
    consultora_id: CONS_ID,
    tipo: 'custom',
    titulo: overrides.titulo ?? 'Test event',
    descripcion: null,
    informe_id: null,
    fecha_vencimiento: overrides.fecha_vencimiento ?? '2099-12-31',
    recurrence_months: null,
    status: 'pending',
    completed_at: null,
    completed_by: null,
    parent_event_id: null,
    reminder_offsets_days: [],
    metadata: null,
    created_by: OWNER_ID,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function isoDaysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  authGetUserMock.mockResolvedValue({ data: { user: { id: OWNER_ID } } });
});

afterEach(() => {
  cleanup();
  authGetUserMock.mockReset();
  getUpcomingMock.mockReset();
  getOverdueMock.mockReset();
});

describe('ProximosVencimientosPanel', () => {
  it('counts correctos con eventos mixed: 1 overdue + 1 today + 2 en 7d + 3 en 30d', async () => {
    getOverdueMock.mockResolvedValue([
      makeEvent({ id: 'o1', titulo: 'Overdue viejo', fecha_vencimiento: isoDaysFromNow(-10) }),
    ]);
    getUpcomingMock.mockResolvedValue([
      makeEvent({ id: 't1', titulo: 'Vence hoy', fecha_vencimiento: isoDaysFromNow(0) }),
      makeEvent({ id: 's1', fecha_vencimiento: isoDaysFromNow(2) }),
      makeEvent({ id: 's2', fecha_vencimiento: isoDaysFromNow(7) }),
      makeEvent({ id: 't1b', fecha_vencimiento: isoDaysFromNow(10) }),
      makeEvent({ id: 't2b', fecha_vencimiento: isoDaysFromNow(15) }),
      makeEvent({ id: 't3b', fecha_vencimiento: isoDaysFromNow(28) }),
    ]);

    const ui = await ProximosVencimientosPanel();
    render(ui);

    const hoyRow = screen.getByTestId('stat-hoy');
    expect(hoyRow.dataset.count).toBe('2'); // 1 overdue + 1 today
    const sieteRow = screen.getByTestId('stat-siete');
    expect(sieteRow.dataset.count).toBe('2'); // 2d y 7d
    const treintaRow = screen.getByTestId('stat-treinta');
    expect(treintaRow.dataset.count).toBe('3'); // 10d, 15d, 28d
  });

  it('top events con overdue: prioriza el mas viejo (fecha menor) en posicion 0', async () => {
    getOverdueMock.mockResolvedValue([
      makeEvent({ id: 'old', titulo: 'Mas viejo', fecha_vencimiento: isoDaysFromNow(-30) }),
      makeEvent({ id: 'recent', titulo: 'Menos viejo', fecha_vencimiento: isoDaysFromNow(-2) }),
    ]);
    getUpcomingMock.mockResolvedValue([
      makeEvent({ id: 'fut', fecha_vencimiento: isoDaysFromNow(5) }),
    ]);

    const ui = await ProximosVencimientosPanel();
    render(ui);

    const urgentItems = screen.getAllByTestId(/^urgent-event-/);
    expect(urgentItems[0]).toHaveTextContent(/Mas viejo/);
    expect(urgentItems[0]).toHaveAttribute('href', '/calendario/agenda?event=old');
  });

  it('top events sin overdue: el mas proximo (today o 7d) en posicion 0', async () => {
    getOverdueMock.mockResolvedValue([]);
    getUpcomingMock.mockResolvedValue([
      makeEvent({ id: 'a', titulo: 'Vence hoy', fecha_vencimiento: isoDaysFromNow(0) }),
      makeEvent({ id: 'b', titulo: 'En 5 dias', fecha_vencimiento: isoDaysFromNow(5) }),
    ]);

    const ui = await ProximosVencimientosPanel();
    render(ui);

    const urgentItems = screen.getAllByTestId(/^urgent-event-/);
    expect(urgentItems[0]).toHaveTextContent(/Vence hoy/);
    expect(urgentItems[0]).toHaveAttribute('href', '/calendario/agenda?event=a');
  });

  it('empty state cuando totalCount=0: CTA "Crear vencimiento" → /calendario', async () => {
    getOverdueMock.mockResolvedValue([]);
    getUpcomingMock.mockResolvedValue([]);

    const ui = await ProximosVencimientosPanel();
    render(ui);

    expect(screen.getByTestId('vencimientos-panel-empty')).toBeInTheDocument();
    expect(screen.getByText(/Todo al día/i)).toBeInTheDocument();
    expect(
      screen.getByText(/No tenés vencimientos próximos\. Aprovechá para sumar uno nuevo\./i),
    ).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /Crear vencimiento/i });
    expect(cta).toHaveAttribute('href', '/calendario');
  });

  it('link "Ver todos" apunta a /calendario/agenda', async () => {
    getOverdueMock.mockResolvedValue([]);
    getUpcomingMock.mockResolvedValue([
      makeEvent({ id: 'a', fecha_vencimiento: isoDaysFromNow(3) }),
    ]);
    const ui = await ProximosVencimientosPanel();
    render(ui);
    expect(screen.getByTestId('panel-ver-todos')).toHaveAttribute('href', '/calendario/agenda');
  });

  it('sin user (edge case) devuelve null', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const ui = await ProximosVencimientosPanel();
    expect(ui).toBeNull();
  });
});
