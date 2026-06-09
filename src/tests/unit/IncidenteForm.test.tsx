/**
 * T-063 · Tests del IncidenteForm (campos condicionales por tipo + manejo del
 * discriminated union de las actions).
 *
 * Las interacciones con `Select` de Radix son frágiles en jsdom, así que el
 * toggle de la sección Lesión se testea vía estado inicial (create=casi_accidente
 * → oculta; corregir con accidente → visible) en lugar de drivear el Select.
 */
import type { IncidenteRow } from '@/app/(app)/accidentabilidad/queries';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IncidenteForm } from '@/app/(app)/accidentabilidad/IncidenteForm';

const {
  pushMock,
  refreshMock,
  backMock,
  toastSuccessMock,
  toastErrorMock,
  toastInfoMock,
  registerMock,
  corregirMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  backMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  registerMock: vi.fn(),
  corregirMock: vi.fn(),
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

vi.mock('@/app/(app)/accidentabilidad/actions', () => ({
  registerIncidenteAction: (input: unknown) => registerMock(input),
  corregirIncidenteAction: (input: unknown) => corregirMock(input),
  anularIncidenteAction: vi.fn(),
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

const CLIENTES = [{ id: 'cli-1', razon_social: 'Acme S.A.' }];
const EMPLEADOS = [
  {
    id: 'emp-1',
    nombre: 'Juan',
    apellido: 'Pérez',
    dni: '20111222',
    cliente_id: 'cli-1',
    cliente_razon_social: 'Acme S.A.',
  },
];

function makeIncidente(overrides: Partial<IncidenteRow> = {}): IncidenteRow {
  return {
    id: 'inc-1',
    consultora_id: 'cons-1',
    cliente_id: 'cli-1',
    empleado_id: 'emp-1',
    tipo: 'accidente',
    fecha: '2020-06-01',
    hora: '10:30:00',
    lugar_especifico: 'Sector de prensas',
    descripcion: 'Atrapamiento de mano en prensa hidráulica.',
    causa_raiz: 'Falta de protección física en el punto de operación.',
    accion_inmediata: 'Se detuvo la máquina y se asistió al operario.',
    gravedad: 'grave',
    dias_perdidos: 12,
    informe_id: null,
    corrige_id: null,
    anulacion: false,
    created_by: 'user-1',
    created_at: '2020-06-01T13:00:00.000Z',
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
  registerMock.mockReset();
  corregirMock.mockReset();
});
afterEach(() => cleanup());

describe('IncidenteForm', () => {
  it('mode=create renderiza Clasificación/Contexto/Descripción y oculta Lesión (casi_accidente por defecto)', () => {
    render(<IncidenteForm mode="create" clientes={CLIENTES} empleados={EMPLEADOS} />);
    expect(screen.getByText('Clasificación')).toBeInTheDocument();
    expect(screen.getByText('Contexto')).toBeInTheDocument();
    expect(screen.getByText('Descripción')).toBeInTheDocument();
    // Lesión sólo aparece para accidente con lesión.
    expect(screen.queryByText('Lesión')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Registrar incidente/i })).toBeInTheDocument();
  });

  it('mode=corregir con accidente muestra la sección Lesión + prellena días perdidos', () => {
    const incidente = makeIncidente();
    render(
      <IncidenteForm
        mode="corregir"
        corrigeId={incidente.id}
        initialValues={incidente}
        clientes={CLIENTES}
        empleados={EMPLEADOS}
      />,
    );
    expect(screen.getByText('Lesión')).toBeInTheDocument();
    expect(screen.getByText('Gravedad *')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar corrección/i })).toBeInTheDocument();
  });

  it('submit create OK: register llamado con tipo casi_accidente → toast.success + push al detalle', async () => {
    registerMock.mockResolvedValueOnce({ ok: true, incidenteId: 'inc-99' });
    render(<IncidenteForm mode="create" clientes={CLIENTES} empleados={EMPLEADOS} />);

    fireEvent.change(screen.getByLabelText(/Fecha/), { target: { value: '2020-06-01' } });
    fireEvent.change(screen.getByLabelText(/Qué pasó/), {
      target: { value: 'Resbalón en el sector de carga, sin lesión.' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Registrar incidente/i }));

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledTimes(1);
    });
    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'casi_accidente',
        fecha: '2020-06-01',
        descripcion: 'Resbalón en el sector de carga, sin lesión.',
        gravedad: undefined,
      }),
    );
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('Incidente registrado');
      expect(pushMock).toHaveBeenCalledWith('/accidentabilidad/inc-99');
    });
  });

  it('submit con INVALID_INPUT → form.setError inline + toast.error', async () => {
    registerMock.mockResolvedValueOnce({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { descripcion: ['Error del servidor en la descripción.'] },
      message: 'Revisá los campos del formulario.',
    });
    render(<IncidenteForm mode="create" clientes={CLIENTES} empleados={EMPLEADOS} />);

    fireEvent.change(screen.getByLabelText(/Fecha/), { target: { value: '2020-06-01' } });
    fireEvent.change(screen.getByLabelText(/Qué pasó/), {
      target: { value: 'Texto válido de descripción.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Registrar incidente/i }));

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Datos inválidos',
        expect.objectContaining({ description: expect.any(String) }),
      );
    });
    expect(screen.getByText('Error del servidor en la descripción.')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('submit con BILLING_GATED → toast.error "Plan expirado" con acción', async () => {
    registerMock.mockResolvedValueOnce({
      ok: false,
      code: 'BILLING_GATED',
      reason: 'trial_expired',
      message: 'Tu período de prueba expiró.',
    });
    render(<IncidenteForm mode="create" clientes={CLIENTES} empleados={EMPLEADOS} />);

    fireEvent.change(screen.getByLabelText(/Fecha/), { target: { value: '2020-06-01' } });
    fireEvent.change(screen.getByLabelText(/Qué pasó/), {
      target: { value: 'Otra descripción válida de prueba.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Registrar incidente/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Plan expirado',
        expect.objectContaining({
          description: 'Tu período de prueba expiró.',
          action: expect.objectContaining({ label: 'Suscribirme' }),
        }),
      );
    });
  });

  it('submit corregir → corregir llamado con corrige_id', async () => {
    corregirMock.mockResolvedValueOnce({ ok: true, incidenteId: 'inc-100' });
    const incidente = makeIncidente();
    render(
      <IncidenteForm
        mode="corregir"
        corrigeId={incidente.id}
        initialValues={incidente}
        clientes={CLIENTES}
        empleados={EMPLEADOS}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Guardar corrección/i }));

    await waitFor(() => {
      expect(corregirMock).toHaveBeenCalledTimes(1);
    });
    expect(corregirMock).toHaveBeenCalledWith(
      expect.objectContaining({ corrige_id: 'inc-1', tipo: 'accidente', gravedad: 'grave' }),
    );
  });
});
