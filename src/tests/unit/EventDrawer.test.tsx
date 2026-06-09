/**
 * T-029 · Tests del EventDrawer (3 modos + permission gate + ajuste 4).
 */
import type { DrawerState } from '@/app/(app)/calendario/EventDrawer';
import type { CalendarEventRow } from '@/app/(app)/calendario/queries';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventDrawer } from '@/app/(app)/calendario/EventDrawer';
import { TooltipProvider } from '@/shared/ui/tooltip';

vi.mock('server-only', () => ({}));

// jsdom no implementa ResizeObserver. Radix Select y Popover lo usan via
// `useSize` internamente al medir el trigger. Stub minimo es suficiente —
// no necesitamos medir layout en estos tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
// jsdom tampoco implementa scrollIntoView. Radix lo llama al abrir Selects.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
// PointerCapture no existe en jsdom; Radix Select lo usa.
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

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

vi.mock('@/app/(app)/calendario/actions', () => ({
  createCalendarEventAction: vi.fn(() =>
    Promise.resolve({
      ok: true,
      eventId: 'new-id',
      remindersCreated: 4,
      remindersSkippedPast: 0,
    }),
  ),
  updateCalendarEventAction: vi.fn(() =>
    Promise.resolve({
      ok: true,
      eventId: 'evt-1',
      remindersRecomputed: false,
      remindersCreated: 0,
      remindersSkippedPast: 0,
    }),
  ),
  completeCalendarEventAction: vi.fn(() =>
    Promise.resolve({
      ok: true,
      eventId: 'evt-1',
      nextEventId: null,
      nextRemindersCreated: 0,
      nextRemindersSkippedPast: 0,
    }),
  ),
  cancelCalendarEventAction: vi.fn(() => Promise.resolve({ ok: true, eventId: 'evt-1' })),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

afterEach(() => cleanup());

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
    fecha_vencimiento: '2026-08-15',
    recurrence_months: 12,
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

function renderDrawer(opts: {
  state: DrawerState;
  events?: CalendarEventRow[];
  currentUserId?: string;
  currentUserRole?: 'owner' | 'member';
}) {
  return render(
    <TooltipProvider>
      <EventDrawer
        state={opts.state}
        events={opts.events ?? []}
        currentUserId={opts.currentUserId ?? OWNER_ID}
        currentUserRole={opts.currentUserRole ?? 'owner'}
        currentMonth={{ year: 2026, month: 8 }}
        onClose={vi.fn()}
        onSwitchToEdit={vi.fn()}
        onMutated={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe('EventDrawer modos', () => {
  it('mode=closed → no renderiza Sheet content', () => {
    renderDrawer({ state: { mode: 'closed' } });
    expect(screen.queryByTestId('drawer-title')).not.toBeInTheDocument();
  });

  it('mode=view con event presente → renderiza titulo, fecha, tipo', () => {
    const event = makeEvent({ titulo: 'Smoke event' });
    renderDrawer({ state: { mode: 'view', eventId: event.id }, events: [event] });
    expect(screen.getByTestId('drawer-title').textContent).toBe('Detalle del vencimiento');
    expect(screen.getByTestId('event-titulo').textContent).toBe('Smoke event');
    expect(screen.getByText(/RGRL anual/)).toBeInTheDocument();
  });

  it('mode=view con event missing → fallback "no encontrado"', () => {
    renderDrawer({ state: { mode: 'view', eventId: 'missing-id' }, events: [] });
    expect(screen.getByTestId('event-not-found')).toBeInTheDocument();
  });

  it('mode=create → renderiza titulo "Nuevo vencimiento" + form (input titulo presente)', () => {
    renderDrawer({ state: { mode: 'create', fechaPrepop: null } });
    expect(screen.getByTestId('drawer-title').textContent).toBe('Nuevo vencimiento');
    expect(screen.getByLabelText(/Título/)).toBeInTheDocument();
  });

  it('mode=edit con event → form precargado con titulo del evento', () => {
    const event = makeEvent({ titulo: 'Editame' });
    renderDrawer({ state: { mode: 'edit', eventId: event.id }, events: [event] });
    expect(screen.getByTestId('drawer-title').textContent).toBe('Editar vencimiento');
    const tituloInput = screen.getByLabelText(/Título/);
    expect(tituloInput).toHaveValue('Editame');
  });
});

describe('EventDrawer permission gate (ajuste 4)', () => {
  it('view con currentUserId === created_by → boton Editar habilitado', () => {
    const event = makeEvent({ created_by: OWNER_ID });
    renderDrawer({
      state: { mode: 'view', eventId: event.id },
      events: [event],
      currentUserId: OWNER_ID,
      currentUserRole: 'member',
    });
    const editBtn = screen.getByTestId('edit-trigger');
    expect(editBtn).not.toBeDisabled();
  });

  it('view con currentUserRole=owner aunque NO sea creator → Editar habilitado', () => {
    const event = makeEvent({ created_by: MEMBER_ID });
    renderDrawer({
      state: { mode: 'view', eventId: event.id },
      events: [event],
      currentUserId: OWNER_ID,
      currentUserRole: 'owner',
    });
    expect(screen.getByTestId('edit-trigger')).not.toBeDisabled();
  });

  it('view con member non-creator non-owner → Editar disabled + Completar/Cancelar disabled', () => {
    const event = makeEvent({ created_by: OWNER_ID });
    renderDrawer({
      state: { mode: 'view', eventId: event.id },
      events: [event],
      currentUserId: MEMBER_ID,
      currentUserRole: 'member',
    });
    expect(screen.getByTestId('edit-trigger')).toBeDisabled();
    expect(screen.getByTestId('complete-trigger')).toBeDisabled();
    expect(screen.getByTestId('cancel-trigger')).toBeDisabled();
  });
});
