/**
 * T-061b · EjecucionDetailActions: el motivo es obligatorio (≥5) para habilitar
 * el submit del AlertDialog; ok → toast + router.refresh. El resto del union de
 * anularEjecucionAction se cubre en integration/E2E.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EjecucionDetailActions } from '@/app/(app)/checklists/ejecuciones/EjecucionDetailActions';

const { anularMock, pushMock, refreshMock, toastMock } = vi.hoisted(() => ({
  anularMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/app/(app)/checklists/ejecuciones/actions', () => ({
  anularEjecucionAction: (input: unknown) => anularMock(input),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

// Stubs jsdom para Radix AlertDialog.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;

beforeEach(() => {
  anularMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
  toastMock.success.mockReset();
  toastMock.info.mockReset();
});
afterEach(() => cleanup());

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Anular' }));
}

describe('EjecucionDetailActions', () => {
  it('motivo < 5 chars → el botón de confirmar queda deshabilitado (no llama al action)', async () => {
    render(<EjecucionDetailActions executionId="exec-1" />);
    openDialog();

    const confirm = await screen.findByRole('button', { name: 'Anular inspección' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Motivo de la anulación/i), {
      target: { value: 'abc' },
    });
    expect(confirm).toBeDisabled();
    expect(anularMock).not.toHaveBeenCalled();
  });

  it('motivo válido → llama al action y, en ok, refresh + toast.success', async () => {
    anularMock.mockResolvedValue({ ok: true, tombstoneId: 'tomb-1' });
    render(<EjecucionDetailActions executionId="exec-1" />);
    openDialog();

    fireEvent.change(screen.getByLabelText(/Motivo de la anulación/i), {
      target: { value: 'Cargada por error, duplicada' },
    });
    const confirm = await screen.findByRole('button', { name: 'Anular inspección' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(anularMock).toHaveBeenCalledWith({
        executionId: 'exec-1',
        motivo: 'Cargada por error, duplicada',
      }),
    );
    expect(refreshMock).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalled();
  });
});
