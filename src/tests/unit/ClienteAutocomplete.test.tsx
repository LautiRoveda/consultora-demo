/**
 * T-050 · Tests del ClienteAutocomplete del wizard step 2 de informes.
 *
 * Cubre:
 *   1. Sin llamado a searchClientesAction cuando query < 2 chars (UX guard).
 *   2. Llamado a searchClientesAction tras debounce 300ms.
 *   3. Render de resultados + click → onSelect(cliente).
 *   4. Botón "Limpiar selección" → onSelect(null).
 *   5. Empty state "Sin resultados" cuando results=[].
 *
 * jsdom stubs heredados de NotificacionesSettingsView.test (Radix usa
 * Resize/Pointer/scrollIntoView). Mock de searchClientesAction + sonner.
 */
import type { ClienteSummary } from '@/app/(app)/clientes/queries';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClienteAutocomplete } from '@/app/(app)/informes/nuevo/ClienteAutocomplete';

vi.mock('server-only', () => ({}));

// jsdom stubs (Radix Popover).
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

type MockResult =
  | { ok: true; results: ClienteSummary[] }
  | { ok: false; code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'INTERNAL_ERROR'; message: string };

const mockSearchClientesAction = vi
  .fn<(q: unknown) => Promise<MockResult>>()
  .mockResolvedValue({ ok: true, results: [] });

vi.mock('@/app/(app)/clientes/actions', () => ({
  searchClientesAction: (q: unknown) => mockSearchClientesAction(q),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockSearchClientesAction.mockClear();
  mockSearchClientesAction.mockResolvedValue({ ok: true, results: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeCliente(over: Partial<ClienteSummary> = {}): ClienteSummary {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    razon_social: 'Acme Industrial SRL',
    cuit: '30-12345678-9',
    domicilio: 'Av. Siempreviva 742',
    localidad: 'Mar del Plata',
    provincia: 'BA',
    ...over,
  };
}

describe('ClienteAutocomplete', () => {
  it('1. NO llama searchClientesAction si query < 2 chars (UX guard)', async () => {
    render(
      <ClienteAutocomplete
        selectedClienteId={null}
        selectedRazonSocial={null}
        onSelect={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Buscar cliente');
    fireEvent.change(input, { target: { value: 'a' } });
    await vi.advanceTimersByTimeAsync(400);
    expect(mockSearchClientesAction).not.toHaveBeenCalled();
  });

  it('2. llama searchClientesAction tras debounce 300ms', async () => {
    render(
      <ClienteAutocomplete
        selectedClienteId={null}
        selectedRazonSocial={null}
        onSelect={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Buscar cliente');
    fireEvent.change(input, { target: { value: 'ac' } });

    // Antes del debounce no se llamó.
    await vi.advanceTimersByTimeAsync(250);
    expect(mockSearchClientesAction).not.toHaveBeenCalled();

    // Tras el debounce sí.
    await vi.advanceTimersByTimeAsync(100);
    expect(mockSearchClientesAction).toHaveBeenCalledTimes(1);
    expect(mockSearchClientesAction).toHaveBeenCalledWith('ac');
  });

  it('3. renderiza lista de resultados y onSelect dispara con cliente al clickear', async () => {
    const cliente = makeCliente();
    mockSearchClientesAction.mockResolvedValueOnce({ ok: true, results: [cliente] });
    const onSelect = vi.fn();

    render(
      <ClienteAutocomplete
        selectedClienteId={null}
        selectedRazonSocial={null}
        onSelect={onSelect}
      />,
    );
    const input = screen.getByLabelText('Buscar cliente');
    fireEvent.change(input, { target: { value: 'acme' } });
    await vi.advanceTimersByTimeAsync(350);

    // Resultado visible.
    const resultButton = await screen.findByText('Acme Industrial SRL');
    fireEvent.click(resultButton);
    expect(onSelect).toHaveBeenCalledWith(cliente);
  });

  it('4. botón "Limpiar selección" dispara onSelect(null)', () => {
    const onSelect = vi.fn();
    render(
      <ClienteAutocomplete
        selectedClienteId="11111111-1111-1111-1111-111111111111"
        selectedRazonSocial="Acme Industrial SRL"
        onSelect={onSelect}
      />,
    );
    // En modo "selected" el Input no se renderiza; aparece el botón Limpiar.
    expect(screen.queryByLabelText('Buscar cliente')).not.toBeInTheDocument();
    expect(screen.getByText('Acme Industrial SRL')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Limpiar selección de cliente'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('5. estado empty muestra "Sin resultados" cuando results=[]', async () => {
    mockSearchClientesAction.mockResolvedValueOnce({ ok: true, results: [] });
    render(
      <ClienteAutocomplete
        selectedClienteId={null}
        selectedRazonSocial={null}
        onSelect={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Buscar cliente');
    fireEvent.change(input, { target: { value: 'xyzzy' } });
    await vi.advanceTimersByTimeAsync(350);

    expect(await screen.findByText(/Sin resultados/i)).toBeInTheDocument();
  });
});
