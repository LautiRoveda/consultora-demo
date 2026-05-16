/**
 * T-036 · Tests del PostPublishEventDialog.
 *
 * - Render con prepop según informeTipo (mapping a rgrl_anual).
 * - Submit OK -> llama createCalendarEventAction con values del form + cierra.
 * - Cancel -> onOpenChange(false) sin llamar a la action.
 * - Checkbox recordatorios OFF -> reminder_offsets_days undefined.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PostPublishEventDialog } from '@/app/(app)/informes/[id]/editar/PostPublishEventDialog';

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

const routerPush = vi.fn();
const routerRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
  }),
}));

const createActionMock = vi.fn();

vi.mock('@/app/(app)/calendario/actions', () => ({
  createCalendarEventAction: (...args: unknown[]) => createActionMock(...args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (msg: string, opts?: unknown) => toastSuccess(msg, opts),
    error: (msg: string, opts?: unknown) => toastError(msg, opts),
  },
}));

const INFORME_ID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  createActionMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  routerPush.mockReset();
  routerRefresh.mockReset();
});

afterEach(() => cleanup());

describe('PostPublishEventDialog', () => {
  it('1. render con prepop según informeTipo=rgrl: tipo evento = rgrl_anual + titulo = "RGRL anual · <razon>"', () => {
    const onOpenChange = vi.fn();
    render(
      <PostPublishEventDialog
        open={true}
        onOpenChange={onOpenChange}
        informeId={INFORME_ID}
        informeTipo="rgrl"
        informeTitulo="Informe RGRL 2026"
        defaultRazonSocial="Acme SA"
      />,
    );

    // Titulo prepop con mapping del helper.
    const tituloInput = screen.getByLabelText<HTMLInputElement>('Título');
    expect(tituloInput.value).toBe('RGRL anual · Acme SA');
  });

  it('2. submit dispara createCalendarEventAction con shape correcto', async () => {
    createActionMock.mockResolvedValue({
      ok: true,
      eventId: 'new-event-uuid',
      remindersCreated: 4,
      remindersSkippedPast: 0,
    });

    const onOpenChange = vi.fn();
    render(
      <PostPublishEventDialog
        open={true}
        onOpenChange={onOpenChange}
        informeId={INFORME_ID}
        informeTipo="rgrl"
        informeTitulo="Informe RGRL"
        defaultRazonSocial="Acme SA"
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^agendar$/i }));

    await vi.waitFor(() => expect(createActionMock).toHaveBeenCalledTimes(1));
    const arg = createActionMock.mock.calls[0]![0] as {
      tipo: string;
      titulo: string;
      informe_id: string;
      recurrence_months: number;
      reminder_offsets_days: number[];
    };
    expect(arg.tipo).toBe('rgrl_anual');
    expect(arg.titulo).toBe('RGRL anual · Acme SA');
    expect(arg.informe_id).toBe(INFORME_ID);
    expect(arg.recurrence_months).toBe(12);
    expect(arg.reminder_offsets_days).toEqual([60, 30, 7, 0]);

    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('3. checkbox recordatorios OFF -> reminder_offsets_days undefined', async () => {
    createActionMock.mockResolvedValue({
      ok: true,
      eventId: 'new-event-uuid',
      remindersCreated: 0,
      remindersSkippedPast: 0,
    });

    const onOpenChange = vi.fn();
    render(
      <PostPublishEventDialog
        open={true}
        onOpenChange={onOpenChange}
        informeId={INFORME_ID}
        informeTipo="capacitacion"
        informeTitulo="Capacitacion EPP"
        defaultRazonSocial={null}
      />,
    );

    const user = userEvent.setup();
    // Uncheck el checkbox.
    const checkbox = screen.getByRole('checkbox', { name: /crear recordatorios/i });
    await user.click(checkbox);

    await user.click(screen.getByRole('button', { name: /^agendar$/i }));

    await vi.waitFor(() => expect(createActionMock).toHaveBeenCalledTimes(1));
    const arg = createActionMock.mock.calls[0]![0] as {
      reminder_offsets_days: number[] | undefined;
    };
    expect(arg.reminder_offsets_days).toBeUndefined();
  });

  it('4. "Ahora no" cierra el dialog sin llamar a la action', async () => {
    const onOpenChange = vi.fn();
    render(
      <PostPublishEventDialog
        open={true}
        onOpenChange={onOpenChange}
        informeId={INFORME_ID}
        informeTipo="rgrl"
        informeTitulo="Informe RGRL"
        defaultRazonSocial="Acme SA"
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /ahora no/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(createActionMock).not.toHaveBeenCalled();
  });

  it('5. razon_social null -> titulo = informeTitulo (fallback)', () => {
    const onOpenChange = vi.fn();
    render(
      <PostPublishEventDialog
        open={true}
        onOpenChange={onOpenChange}
        informeId={INFORME_ID}
        informeTipo="rgrl"
        informeTitulo="Titulo fallback"
        defaultRazonSocial={null}
      />,
    );
    const tituloInput = screen.getByLabelText<HTMLInputElement>('Título');
    expect(tituloInput.value).toBe('Titulo fallback');
  });

  it('6. tipo capacitacion -> evento tipo = capacitacion + recurrence_months=12', async () => {
    createActionMock.mockResolvedValue({
      ok: true,
      eventId: 'new-event-uuid',
      remindersCreated: 3,
      remindersSkippedPast: 0,
    });

    const onOpenChange = vi.fn();
    render(
      <PostPublishEventDialog
        open={true}
        onOpenChange={onOpenChange}
        informeId={INFORME_ID}
        informeTipo="capacitacion"
        informeTitulo="Capacitacion EPP Marzo"
        defaultRazonSocial="Acme SA"
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^agendar$/i }));

    await vi.waitFor(() => expect(createActionMock).toHaveBeenCalledTimes(1));
    const arg = createActionMock.mock.calls[0]![0] as {
      tipo: string;
      recurrence_months: number;
    };
    expect(arg.tipo).toBe('capacitacion');
    expect(arg.recurrence_months).toBe(12);
  });
});
