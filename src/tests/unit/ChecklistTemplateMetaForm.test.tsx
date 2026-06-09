/**
 * T-059 · Test del TemplateMetaForm: mapeo de codes del union — DUPLICATE_NAME →
 * field error en nombre, BILLING_GATED → toast.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateMetaForm } from '@/app/(app)/checklists/TemplateMetaForm';

const { pushMock, refreshMock, toastErrorMock, toastSuccessMock, createMock, updateMock } =
  vi.hoisted(() => ({
    pushMock: vi.fn(),
    refreshMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    createMock: vi.fn(),
    updateMock: vi.fn(),
  }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock, back: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock, info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/app/(app)/checklists/actions', () => ({
  createChecklistTemplateAction: (input: unknown) => createMock(input),
  updateTemplateMetaAction: (input: unknown) => updateMock(input),
}));

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

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
});
afterEach(() => cleanup());

describe('TemplateMetaForm', () => {
  it('happy create → createChecklistTemplateAction + push al detalle', async () => {
    createMock.mockResolvedValue({ ok: true, templateId: 'tpl-1', versionId: 'ver-1' });
    render(<TemplateMetaForm mode="create" />);
    fireEvent.change(screen.getByPlaceholderText('RGRL planta norte'), {
      target: { value: 'Mi checklist' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Crear template/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0]![0]).toMatchObject({
      nombre: 'Mi checklist',
      tipo_inspeccion: 'rgrl_463_09',
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/checklists/tpl-1'));
  });

  it('DUPLICATE_NAME → setError en nombre + toast', async () => {
    createMock.mockResolvedValue({
      ok: false,
      code: 'DUPLICATE_NAME',
      fieldErrors: { nombre: ['Ya existe un template activo con ese nombre.'] },
      message: 'Nombre duplicado.',
    });
    render(<TemplateMetaForm mode="create" />);
    fireEvent.change(screen.getByPlaceholderText('RGRL planta norte'), {
      target: { value: 'Repetido' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Crear template/i }));

    expect(
      await screen.findByText('Ya existe un template activo con ese nombre.'),
    ).toBeInTheDocument();
    expect(toastErrorMock).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('BILLING_GATED → toast de suscripción (sin field error)', async () => {
    createMock.mockResolvedValue({
      ok: false,
      code: 'BILLING_GATED',
      reason: 'TRIAL_EXPIRED',
      message: 'Tu prueba venció. Suscribite para seguir.',
    });
    render(<TemplateMetaForm mode="create" />);
    fireEvent.change(screen.getByPlaceholderText('RGRL planta norte'), {
      target: { value: 'Otro' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Crear template/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(toastErrorMock.mock.calls[0]![0]).toMatch(/Suscripción/i);
  });
});
