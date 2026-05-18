/**
 * T-049 · Tests del ClienteForm (4 secciones + CUIT autoformat + DUPLICATE_CUIT handling).
 */
import type { ClienteRow } from '@/app/(app)/clientes/queries';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClienteForm } from '@/app/(app)/clientes/ClienteForm';

// vi.hoisted: vitest hoist vi.mock al tope; las consts referenced en factories
// deben estar disponibles en el orden hoisted. Sino: ReferenceError.
const {
  pushMock,
  refreshMock,
  backMock,
  toastSuccessMock,
  toastErrorMock,
  toastInfoMock,
  createMock,
  updateMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  backMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    refresh: refreshMock,
    back: backMock,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    info: toastInfoMock,
    warning: vi.fn(),
  },
}));

vi.mock('@/app/(app)/clientes/actions', () => ({
  createClienteAction: (input: unknown) => createMock(input),
  updateClienteAction: (id: unknown, patch: unknown) => updateMock(id, patch),
  archiveClienteAction: vi.fn(),
  unarchiveClienteAction: vi.fn(),
}));

// Stubs jsdom requeridos por Radix Select.
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

function makeCliente(overrides: Partial<ClienteRow> = {}): ClienteRow {
  return {
    id: 'cli-123',
    consultora_id: 'cons-1',
    razon_social: 'Acme S.A.',
    cuit: '30-12345678-9',
    nombre_fantasia: 'El Galpón',
    domicilio: 'Av. Siempre Viva 1234',
    localidad: 'San Justo',
    provincia: 'BA',
    contacto_nombre: 'Juan Pérez',
    contacto_email: 'juan@acme.com.ar',
    contacto_telefono: '011-4444-5555',
    industria: 'Metalúrgica',
    art: 'Provincia ART',
    notas: 'Cliente premium',
    archived_at: null,
    created_by: 'user-1',
    created_at: '2026-05-01T10:00:00.000Z',
    updated_at: '2026-05-01T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
  backMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  toastInfoMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
});
afterEach(() => cleanup());

describe('ClienteForm', () => {
  it('mode=create renderiza las 4 secciones + razon_social/cuit marcados con asterisco', () => {
    render(<ClienteForm mode="create" />);
    expect(screen.getByText('Identificación')).toBeInTheDocument();
    expect(screen.getByText('Ubicación')).toBeInTheDocument();
    expect(screen.getByText('Contacto')).toBeInTheDocument();
    expect(screen.getByText('Detalles')).toBeInTheDocument();
    expect(screen.getByText('Razón social *')).toBeInTheDocument();
    expect(screen.getByText('CUIT *')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear cliente/i })).toBeInTheDocument();
  });

  it('mode=edit con initialValues pre-popula los inputs', () => {
    const cliente = makeCliente();
    render(<ClienteForm mode="edit" clienteId={cliente.id} initialValues={cliente} />);
    expect(screen.getByDisplayValue('Acme S.A.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('30-12345678-9')).toBeInTheDocument();
    expect(screen.getByDisplayValue('El Galpón')).toBeInTheDocument();
    expect(screen.getByDisplayValue('juan@acme.com.ar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar cambios/i })).toBeInTheDocument();
  });

  it('CUIT onBlur: tipear "30123456789" sin guiones + blur → field value pasa a "30-12345678-9"', () => {
    render(<ClienteForm mode="create" />);
    const cuitInput = screen.getByPlaceholderText('30-12345678-9');
    fireEvent.change(cuitInput, { target: { value: '30123456789' } });
    fireEvent.blur(cuitInput);
    expect((cuitInput as HTMLInputElement).value).toBe('30-12345678-9');
  });

  it('submit con result DUPLICATE_CUIT → form.setError en cuit + toast.error', async () => {
    createMock.mockResolvedValueOnce({
      ok: false,
      code: 'DUPLICATE_CUIT',
      fieldErrors: { cuit: ['Ya existe un cliente activo con este CUIT.'] },
      message: 'Ya existe un cliente activo con CUIT 30-12345678-9.',
    });

    render(<ClienteForm mode="create" />);
    // Completar fields required: razon_social + cuit.
    const razonInput = screen.getByPlaceholderText('Acme S.A.');
    fireEvent.change(razonInput, { target: { value: 'Empresa Nueva' } });
    const cuitInput = screen.getByPlaceholderText('30-12345678-9');
    fireEvent.change(cuitInput, { target: { value: '30-12345678-9' } });

    const submit = screen.getByRole('button', { name: /Crear cliente/i });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock).toHaveBeenCalledWith(
        'CUIT duplicado',
        expect.objectContaining({ description: expect.any(String) }),
      );
    });
    // El error inline aparece debajo del CUIT field.
    expect(screen.getByText('Ya existe un cliente activo con este CUIT.')).toBeInTheDocument();
    // pushMock NO debería haberse llamado (no hubo navegación a /clientes/[id]).
    expect(pushMock).not.toHaveBeenCalled();
  });
});
