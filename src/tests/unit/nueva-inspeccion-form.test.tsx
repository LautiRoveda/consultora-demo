/**
 * T-061a · NuevaInspeccionForm: validación client (template + cliente requeridos)
 * y preselect de template. El mapeo de codes del backend (VERSION_NOT_PUBLISHED /
 * NO_CLIENTE / ok→redirect) se cubre en el E2E + integration (Radix Select no se
 * maneja en jsdom en este repo).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NuevaInspeccionForm } from '@/app/(app)/checklists/ejecuciones/nueva/NuevaInspeccionForm';

const { createMock, pushMock } = vi.hoisted(() => ({ createMock: vi.fn(), pushMock: vi.fn() }));

vi.mock('@/app/(app)/checklists/ejecuciones/actions', () => ({
  createEjecucionAction: (input: unknown) => createMock(input),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Stubs jsdom para Radix Select.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;

const templates = [{ id: 't1', nombre: 'RGRL', isSystem: true }];
const clientes = [{ id: 'c1', razon_social: 'ACME SA' }];

beforeEach(() => {
  createMock.mockReset();
  pushMock.mockReset();
});
afterEach(() => cleanup());

describe('NuevaInspeccionForm', () => {
  it('submit vacío → dos errores inline y NO llama al action', async () => {
    render(<NuevaInspeccionForm templates={templates} clientes={clientes} />);
    fireEvent.click(screen.getByRole('button', { name: /Comenzar inspección/i }));

    await waitFor(() => {
      expect(screen.getByText('Elegí un template.')).toBeInTheDocument();
      expect(screen.getByText('Elegí un cliente.')).toBeInTheDocument();
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('con template preseleccionado, submit → solo falta el cliente (action no llamado)', async () => {
    render(
      <NuevaInspeccionForm templates={templates} clientes={clientes} initialTemplateId="t1" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Comenzar inspección/i }));

    await waitFor(() => {
      expect(screen.getByText('Elegí un cliente.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Elegí un template.')).not.toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
