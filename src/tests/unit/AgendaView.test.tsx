/**
 * T-030 · Tests del orquestador AgendaView.
 *
 * Lo que cubrimos aca (los detalles del card/buckets viven en sus propios
 * tests):
 *  - Render con buckets: 4 secciones cuando hay eventos en cada bucket.
 *  - Bucket vacio NO se renderiza (no aparece "Vencen HOY (0)").
 *  - Empty state si todos los buckets vacios.
 *  - mode='flat' renderiza lista plana, no buckets.
 *  - CTA "Nuevo vencimiento" abre el drawer en mode create.
 */
import type { CalendarEventRow } from '@/app/(app)/calendario/queries';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgendaView } from '@/app/(app)/calendario/agenda/AgendaView';
import { todayCivilIsoAR } from '@/shared/lib/format-date';

vi.mock('server-only', () => ({}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

const replaceMock = vi.fn();
const refreshMock = vi.fn();
const searchParamsMock = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: (...args: unknown[]) => replaceMock(...args),
    refresh: refreshMock,
  }),
  useSearchParams: () => searchParamsMock,
  usePathname: () => '/calendario/agenda',
}));

vi.mock('@/app/(app)/calendario/actions', () => ({
  createCalendarEventAction: vi.fn(() =>
    Promise.resolve({
      ok: true,
      eventId: 'new-id',
      remindersCreated: 1,
      remindersSkippedPast: 0,
    }),
  ),
  updateCalendarEventAction: vi.fn(() =>
    Promise.resolve({
      ok: true,
      eventId: 'evt',
      remindersRecomputed: false,
      remindersCreated: 0,
      remindersSkippedPast: 0,
    }),
  ),
  completeCalendarEventAction: vi.fn(() =>
    Promise.resolve({
      ok: true,
      eventId: 'evt',
      nextEventId: null,
      remindersSkipped: 0,
      nextRemindersCreated: 0,
      nextRemindersSkippedPast: 0,
    }),
  ),
  cancelCalendarEventAction: vi.fn(() =>
    Promise.resolve({ ok: true, eventId: 'evt', remindersSkipped: 0 }),
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

afterEach(() => {
  cleanup();
  replaceMock.mockClear();
  refreshMock.mockClear();
});

const OWNER_ID = '00000000-0000-4000-8000-00000000aaaa';

function makeEvent(overrides: Partial<CalendarEventRow>): CalendarEventRow {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-000000000001',
    consultora_id: '00000000-0000-4000-8000-000000000aaa',
    tipo: 'custom',
    titulo: overrides.titulo ?? 'Evento test',
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

// Cross-day fix: el bucketing de prod usa `todayCivilIsoAR()` (TZ AR, T-085).
// Si construimos el offset desde `new Date()` UTC, en runners que corren entre
// 00:00 y 03:00 UTC (= 21:00-00:00 AR del dia anterior) el "hoy" UTC adelanta
// un dia al "hoy" AR → el evento "hoy" cae en bucket-siete y los tests fallan.
// Anclamos el offset a `todayCivilIsoAR()` para que sea idempotente.
function isoDaysFromNow(n: number): string {
  const todayCivil = todayCivilIsoAR();
  const [y, m, d] = todayCivil.split('-').map(Number) as [number, number, number];
  // UTC noon evita que setUTCDate cruce de dia por TZ del runner.
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function renderAgenda(opts: Partial<Parameters<typeof AgendaView>[0]> = {}) {
  const defaultProps: Parameters<typeof AgendaView>[0] = {
    initialEvents: [],
    initialFilters: { tipo: [], status: ['pending'] },
    initialEventOpen: null,
    currentUserId: OWNER_ID,
    currentUserRole: 'owner',
    mode: 'buckets',
    initialEppContextByEventId: {},
  };
  return render(<AgendaView {...defaultProps} {...opts} />);
}

describe('AgendaView', () => {
  it('renderiza 4 secciones cuando hay 1 evento en cada bucket', () => {
    const events = [
      makeEvent({ id: 'a', titulo: 'Hoy', fecha_vencimiento: isoDaysFromNow(0) }),
      makeEvent({ id: 'b', titulo: 'En 5 dias', fecha_vencimiento: isoDaysFromNow(5) }),
      makeEvent({ id: 'c', titulo: 'En 20 dias', fecha_vencimiento: isoDaysFromNow(20) }),
      makeEvent({ id: 'd', titulo: 'En 60 dias', fecha_vencimiento: isoDaysFromNow(60) }),
    ];
    renderAgenda({ initialEvents: events });

    expect(screen.getByTestId('bucket-hoy')).toBeInTheDocument();
    expect(screen.getByTestId('bucket-siete')).toBeInTheDocument();
    expect(screen.getByTestId('bucket-treinta')).toBeInTheDocument();
    expect(screen.getByTestId('bucket-mas-adelante')).toBeInTheDocument();
  });

  it('bucket vacio NO se renderiza (no muestra "Vencen HOY 0")', () => {
    const events = [
      makeEvent({ id: 'a', titulo: 'En 5 dias', fecha_vencimiento: isoDaysFromNow(5) }),
    ];
    renderAgenda({ initialEvents: events });

    expect(screen.queryByTestId('bucket-hoy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bucket-treinta')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bucket-mas-adelante')).not.toBeInTheDocument();
    expect(screen.getByTestId('bucket-siete')).toBeInTheDocument();
  });

  it('empty state con todos los buckets vacios', () => {
    renderAgenda({ initialEvents: [] });
    expect(screen.getByTestId('agenda-empty')).toBeInTheDocument();
    expect(screen.getByText(/No hay vencimientos pendientes/i)).toBeInTheDocument();
  });

  it('mode=flat renderiza lista plana, no buckets', () => {
    const events = [
      makeEvent({ id: 'a', titulo: 'Completado A', status: 'completed' }),
      makeEvent({ id: 'b', titulo: 'Cancelado B', status: 'cancelled' }),
    ];
    renderAgenda({
      initialEvents: events,
      initialFilters: { tipo: [], status: ['completed', 'cancelled'] },
      mode: 'flat',
    });

    expect(screen.getByTestId('agenda-flat-list')).toBeInTheDocument();
    expect(screen.getByText('Completado A')).toBeInTheDocument();
    expect(screen.getByText('Cancelado B')).toBeInTheDocument();
    expect(screen.queryByTestId('bucket-hoy')).not.toBeInTheDocument();
  });

  it('click "Nuevo vencimiento" abre drawer mode=create (drawer-title visible)', () => {
    renderAgenda({ initialEvents: [] });
    fireEvent.click(screen.getByTestId('agenda-cta-new'));
    // El drawer mode=create renderea con SheetTitle "Nuevo vencimiento"
    // (mismo data-testid='drawer-title' que T-029).
    expect(screen.getByTestId('drawer-title')).toHaveTextContent(/Nuevo vencimiento/i);
  });
});
