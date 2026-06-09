/**
 * T-128 · Tests del EmpleadoForm con el selector de puesto del catálogo.
 *
 * Cubre:
 *  1. Seleccionar un puesto del combobox → createEmpleadoAction con puesto_id.
 *  2. Sin elegir puesto → createEmpleadoAction SIN puesto_id (opcional).
 *  3. Crear-inline: abre Dialog → createPuestoAction({nombre,riesgos}) → queda seleccionado.
 *  4. Gate owner: canCrearPuesto=false → no aparece "Crear puesto nuevo".
 *  5. Edición con ≥2 puestos → selector read-only + link a la ficha (sin combobox).
 *
 * jsdom stubs Radix (Popover/Dialog) + mock de actions + sonner + navigation.
 */
import type { EmpleadoRow } from '@/app/(app)/empleados/queries';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmpleadoForm } from '@/app/(app)/empleados/EmpleadoForm';

const {
  pushMock,
  refreshMock,
  backMock,
  createEmpleadoMock,
  updateEmpleadoMock,
  createPuestoMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  backMock: vi.fn(),
  createEmpleadoMock: vi.fn(),
  updateEmpleadoMock: vi.fn(),
  createPuestoMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock, back: backMock }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/app/(app)/empleados/actions', () => ({
  createEmpleadoAction: (input: unknown) => createEmpleadoMock(input),
  updateEmpleadoAction: (id: unknown, patch: unknown) => updateEmpleadoMock(id, patch),
}));

vi.mock('@/app/(app)/epp/catalogo/actions', () => ({
  createPuestoAction: (input: unknown) => createPuestoMock(input),
}));

// Stubs jsdom requeridos por Radix Popover / Dialog.
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

const CLIENTE_ID = '22222222-2222-4222-8222-222222222222';
const PUESTO_SOLDADOR = { id: '11111111-1111-4111-8111-111111111111', nombre: 'Soldador' };
const PUESTO_OPERARIO = { id: '33333333-3333-4333-8333-333333333333', nombre: 'Operario' };
const EMPLEADO_ID = '44444444-4444-4444-8444-444444444444';

function makeEmpleado(over: Partial<EmpleadoRow> = {}): EmpleadoRow {
  return {
    id: EMPLEADO_ID,
    consultora_id: 'cons-1',
    cliente_id: CLIENTE_ID,
    nombre: 'Juan',
    apellido: 'Pérez',
    dni: '12345678',
    cuil: null,
    email: null,
    telefono: null,
    fecha_ingreso: null,
    fecha_nacimiento: null,
    notas: null,
    archived_at: null,
    created_by: 'user-1',
    created_at: '2026-05-01T10:00:00.000Z',
    updated_at: '2026-05-01T10:00:00.000Z',
    ...over,
  };
}

function fillRequired() {
  fireEvent.change(screen.getByPlaceholderText('Juan'), { target: { value: 'Juan' } });
  fireEvent.change(screen.getByPlaceholderText('Pérez'), { target: { value: 'Pérez' } });
  fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value: '12345678' } });
}

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
  backMock.mockReset();
  createEmpleadoMock.mockReset().mockResolvedValue({ ok: true, empleadoId: 'new-emp' });
  updateEmpleadoMock.mockReset().mockResolvedValue({ ok: true, empleadoId: 'emp-1' });
  createPuestoMock.mockReset();
});
afterEach(() => cleanup());

describe('EmpleadoForm · selector de puesto (T-128)', () => {
  it('1. seleccionar un puesto del combobox → createEmpleadoAction con puesto_id', async () => {
    render(
      <EmpleadoForm
        mode="create"
        clienteId={CLIENTE_ID}
        clienteRazonSocial="Acme"
        catalogoPuestos={[PUESTO_SOLDADOR, PUESTO_OPERARIO]}
        canCrearPuesto
      />,
    );

    fillRequired();

    // Abrir el combobox y elegir "Soldador".
    fireEvent.change(screen.getByLabelText('Buscar puesto'), { target: { value: 'Sold' } });
    fireEvent.click(await screen.findByText('Soldador'));

    fireEvent.click(screen.getByRole('button', { name: /Crear empleado/i }));

    await waitFor(() => {
      expect(createEmpleadoMock).toHaveBeenCalledTimes(1);
      expect(createEmpleadoMock).toHaveBeenCalledWith(
        expect.objectContaining({ puesto_id: PUESTO_SOLDADOR.id, cliente_id: CLIENTE_ID }),
      );
    });
  });

  it('2. sin elegir puesto → createEmpleadoAction SIN puesto_id (opcional)', async () => {
    render(
      <EmpleadoForm
        mode="create"
        clienteId={CLIENTE_ID}
        clienteRazonSocial="Acme"
        catalogoPuestos={[PUESTO_SOLDADOR]}
        canCrearPuesto
      />,
    );

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /Crear empleado/i }));

    await waitFor(() => expect(createEmpleadoMock).toHaveBeenCalledTimes(1));
    const payload = createEmpleadoMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('puesto_id');
  });

  it('3. crear-inline → createPuestoAction y queda seleccionado', async () => {
    createPuestoMock.mockResolvedValueOnce({
      ok: true,
      id: '55555555-5555-4555-8555-555555555555',
    });
    render(
      <EmpleadoForm
        mode="create"
        clienteId={CLIENTE_ID}
        clienteRazonSocial="Acme"
        catalogoPuestos={[]}
        canCrearPuesto
      />,
    );

    // Abrir el combobox y disparar "Crear puesto nuevo".
    fireEvent.change(screen.getByLabelText('Buscar puesto'), { target: { value: 'Tornero' } });
    fireEvent.click(await screen.findByText('Crear puesto nuevo'));

    // Dialog: nombre prefilled con el query + riesgos por comas. Label propio
    // ("Nombre del puesto") para no colisionar con el "Nombre *" del empleado.
    const nombreInput = await screen.findByLabelText('Nombre del puesto *');
    expect((nombreInput as HTMLInputElement).value).toBe('Tornero');
    fireEvent.change(screen.getByLabelText('Riesgos asociados'), {
      target: { value: 'ruido, caída de altura' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Crear y seleccionar/i }));

    await waitFor(() => {
      expect(createPuestoMock).toHaveBeenCalledWith({
        nombre: 'Tornero',
        riesgos_asociados: ['ruido', 'caída de altura'],
      });
    });
    // El puesto creado queda seleccionado (aparece el chip con su nombre).
    expect(await screen.findByText('Tornero')).toBeInTheDocument();
  });

  it('4. canCrearPuesto=false → no aparece "Crear puesto nuevo"', async () => {
    render(
      <EmpleadoForm
        mode="create"
        clienteId={CLIENTE_ID}
        clienteRazonSocial="Acme"
        catalogoPuestos={[PUESTO_SOLDADOR]}
        canCrearPuesto={false}
      />,
    );
    fireEvent.change(screen.getByLabelText('Buscar puesto'), { target: { value: 'S' } });
    await screen.findByText('Soldador');
    expect(screen.queryByText('Crear puesto nuevo')).not.toBeInTheDocument();
  });

  it('5. edición con ≥2 puestos → read-only + link a la ficha (sin combobox)', () => {
    render(
      <EmpleadoForm
        mode="edit"
        empleadoId={EMPLEADO_ID}
        clienteId={CLIENTE_ID}
        clienteRazonSocial="Acme"
        initialValues={makeEmpleado()}
        catalogoPuestos={[PUESTO_SOLDADOR, PUESTO_OPERARIO]}
        canCrearPuesto
        puestoAsignadoId={null}
        asignadosCount={2}
      />,
    );

    expect(screen.getByText(/tiene 2 puestos del catálogo/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Gestionalos desde la ficha/i });
    expect(link).toHaveAttribute('href', `/empleados/${EMPLEADO_ID}`);
    // El combobox NO se renderiza en este modo.
    expect(screen.queryByLabelText('Buscar puesto')).not.toBeInTheDocument();
  });
});
