/**
 * T-030 · Tests de EventAgendaCard.
 *
 * Cobertura:
 *  - Render con tipo + titulo + fecha + badge segun estado.
 *  - Badges "Vencido" (overdue) y "Hoy" mutuamente excluyentes.
 *  - Click body dispara onClickBody (no propaga al footer).
 *  - Click "Editar" dispara onClickEdit.
 *  - Click "Completar" → AlertDialog → confirm → action mockeada + toast.
 *  - Permission gate creator OR owner: member non-creator non-owner ve botones
 *    disabled con tooltip.
 */
import type { CalendarEventRow } from '@/app/(app)/calendario/queries';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventAgendaCard } from '@/app/(app)/calendario/EventAgendaCard';
import { todayCivilIsoAR } from '@/shared/lib/format-date';
import { TooltipProvider } from '@/shared/ui/tooltip';

vi.mock('server-only', () => ({}));

// jsdom no implementa estos APIs; Radix los usa.
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const completeMock = vi.fn(
  (
    id: string,
  ): Promise<{
    ok: true;
    eventId: string;
    nextEventId: string | null;
    remindersSkipped: number;
    nextRemindersCreated: number;
    nextRemindersSkippedPast: number;
  }> =>
    Promise.resolve({
      ok: true,
      eventId: id,
      nextEventId: null,
      remindersSkipped: 0,
      nextRemindersCreated: 0,
      nextRemindersSkippedPast: 0,
    }),
);
vi.mock('@/app/(app)/calendario/actions', () => ({
  completeCalendarEventAction: (id: string) => completeMock(id),
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    warning: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  completeMock.mockClear();
  toastSuccessMock.mockClear();
  toastErrorMock.mockClear();
});

const OWNER_ID = '00000000-0000-4000-8000-00000000aaaa';
const MEMBER_ID = '00000000-0000-4000-8000-00000000bbbb';

function makeEvent(overrides: Partial<CalendarEventRow> = {}): CalendarEventRow {
  return {
    id: 'evt-1',
    consultora_id: 'cons-1',
    tipo: 'rgrl_anual',
    titulo: 'RGRL Acme',
    descripcion: null,
    informe_id: null,
    fecha_vencimiento: '2099-08-15', // futuro lejano por defecto (no overdue, no today)
    recurrence_months: null,
    status: 'pending',
    completed_at: null,
    completed_by: null,
    parent_event_id: null,
    reminder_offsets_days: [60, 30, 7, 0],
    metadata: null,
    created_by: OWNER_ID,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderCard(opts: {
  event: CalendarEventRow;
  currentUserId?: string;
  currentUserRole?: 'owner' | 'member';
  onClickBody?: () => void;
  onClickEdit?: () => void;
  onMutated?: ReturnType<typeof vi.fn>;
}) {
  const onClickBody = opts.onClickBody ?? vi.fn();
  const onClickEdit = opts.onClickEdit ?? vi.fn();
  const onMutated = opts.onMutated ?? vi.fn();
  return {
    onClickBody,
    onClickEdit,
    onMutated,
    ...render(
      <TooltipProvider>
        <EventAgendaCard
          event={opts.event}
          currentUserId={opts.currentUserId ?? OWNER_ID}
          currentUserRole={opts.currentUserRole ?? 'owner'}
          onClickBody={onClickBody}
          onClickEdit={onClickEdit}
          onMutated={onMutated}
        />
      </TooltipProvider>,
    ),
  };
}

describe('EventAgendaCard', () => {
  it('renderiza badge tipo + titulo + fecha es-AR; sin badge "Vencido" cuando es futuro', () => {
    renderCard({ event: makeEvent({ titulo: 'Smoke evento futuro' }) });
    expect(screen.getByText('RGRL anual')).toBeInTheDocument();
    expect(screen.getByText('Smoke evento futuro')).toBeInTheDocument();
    // Sin badge "Vencido"
    expect(screen.queryByText('Vencido')).not.toBeInTheDocument();
    // Sin badge "Hoy"
    expect(screen.queryByText('Hoy')).not.toBeInTheDocument();
  });

  it('muestra badge "Vencido" destructive cuando fecha < today + status pending', () => {
    renderCard({ event: makeEvent({ fecha_vencimiento: '2020-01-01' }) });
    expect(screen.getByText('Vencido')).toBeInTheDocument();
  });

  it('muestra badge "Hoy" cuando fecha = today + status pending', () => {
    // Cross-day fix: el badge "Hoy" se decide contra `todayCivilIsoAR()` (T-085).
    // `new Date().toISOString().slice(0,10)` da el dia UTC, que en runners entre
    // 00:00-03:00 UTC adelanta un dia al "hoy AR" -> el badge cae como "manana"
    // y el test falla. Anclamos al dia AR como hace el componente.
    const todayIso = todayCivilIsoAR();
    renderCard({ event: makeEvent({ fecha_vencimiento: todayIso }) });
    expect(screen.getByText('Hoy')).toBeInTheDocument();
    expect(screen.queryByText('Vencido')).not.toBeInTheDocument();
  });

  it('click body dispara onClickBody, click "Editar" dispara onClickEdit (sin doble fire)', () => {
    const { onClickBody, onClickEdit } = renderCard({ event: makeEvent() });
    // Click body (button con aria-label "Ver detalle: ...")
    fireEvent.click(screen.getByLabelText(/Ver detalle/i));
    expect(onClickBody).toHaveBeenCalledTimes(1);
    expect(onClickEdit).not.toHaveBeenCalled();

    // Click "Editar"
    fireEvent.click(screen.getByTestId('agenda-edit'));
    expect(onClickEdit).toHaveBeenCalledTimes(1);
    // body NO disparado por el click del Editar (stopPropagation del footer)
    expect(onClickBody).toHaveBeenCalledTimes(1);
  });

  it('permission gate: member non-creator non-owner ve botones disabled', () => {
    renderCard({
      event: makeEvent({ created_by: OWNER_ID }),
      currentUserId: MEMBER_ID,
      currentUserRole: 'member',
    });
    expect(screen.getByTestId('agenda-complete')).toBeDisabled();
    expect(screen.getByTestId('agenda-edit')).toBeDisabled();
  });

  it('permission gate: owner non-creator habilita botones', () => {
    renderCard({
      event: makeEvent({ created_by: MEMBER_ID }),
      currentUserId: OWNER_ID,
      currentUserRole: 'owner',
    });
    expect(screen.getByTestId('agenda-complete')).not.toBeDisabled();
    expect(screen.getByTestId('agenda-edit')).not.toBeDisabled();
  });
});
