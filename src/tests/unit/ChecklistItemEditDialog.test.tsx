/**
 * T-059 · Tests del ItemEditDialog del editor de checklists: validación client,
 * mapeo INVALID_INPUT → field error, VERSION_NOT_DRAFT → toast + refresh.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItemEditDialog } from '@/app/(app)/checklists/[id]/ItemEditDialog';

const { pushMock, refreshMock, toastErrorMock, toastSuccessMock, addMock, updateMock } = vi.hoisted(
  () => ({
    pushMock: vi.fn(),
    refreshMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    addMock: vi.fn(),
    updateMock: vi.fn(),
  }),
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock, back: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock, info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/app/(app)/checklists/actions', () => ({
  addItemAction: (input: unknown) => addMock(input),
  updateItemAction: (input: unknown) => updateMock(input),
}));

// Stubs jsdom requeridos por Radix (Select/Dialog).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

const SECTION_ID = '11111111-1111-1111-1111-111111111111';

function openCreateDialog() {
  render(
    <ItemEditDialog
      mode="create"
      sectionId={SECTION_ID}
      trigger={<button type="button">Abrir</button>}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
}

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  addMock.mockReset();
  updateMock.mockReset();
});
afterEach(() => cleanup());

describe('ItemEditDialog (checklists)', () => {
  it('renderiza los campos al abrir (texto, tipo de respuesta, crítico, requerido)', () => {
    openCreateDialog();
    expect(screen.getByText('Texto del ítem *')).toBeInTheDocument();
    expect(screen.getByText('Tipo de respuesta *')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /crítico/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /requerido/i })).toBeInTheDocument();
  });

  it('texto vacío → validación client (no llama a la action)', async () => {
    openCreateDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('Mínimo 1 carácter.')).toBeInTheDocument();
    expect(addMock).not.toHaveBeenCalled();
  });

  it('happy: llama addItemAction con el payload y muestra success', async () => {
    addMock.mockResolvedValue({ ok: true, itemId: 'it-1' });
    openCreateDialog();
    fireEvent.change(screen.getByPlaceholderText(/tableros eléctricos/i), {
      target: { value: 'Matafuegos vigentes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(1));
    expect(addMock.mock.calls[0]![0]).toMatchObject({
      sectionId: SECTION_ID,
      texto: 'Matafuegos vigentes',
      response_type: 'cumple_no_aplica',
      es_critico: false,
      es_requerido: true,
    });
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalled();
  });

  it('INVALID_INPUT del server → setError en el campo texto', async () => {
    addMock.mockResolvedValue({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { texto: ['Texto inválido del server.'] },
      message: 'Revisá los campos.',
    });
    openCreateDialog();
    fireEvent.change(screen.getByPlaceholderText(/tableros eléctricos/i), {
      target: { value: 'algo válido' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    expect(await screen.findByText('Texto inválido del server.')).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('VERSION_NOT_DRAFT → toast de error + router.refresh', async () => {
    addMock.mockResolvedValue({
      ok: false,
      code: 'VERSION_NOT_DRAFT',
      message: 'La versión ya no está en borrador.',
    });
    openCreateDialog();
    fireEvent.change(screen.getByPlaceholderText(/tableros eléctricos/i), {
      target: { value: 'item x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(toastErrorMock.mock.calls[0]![0]).toMatch(/borrador/i);
    expect(refreshMock).toHaveBeenCalled();
  });
});
