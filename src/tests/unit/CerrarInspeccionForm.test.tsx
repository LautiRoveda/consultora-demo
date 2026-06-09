/**
 * T-061b · CerrarInspeccionForm: mapeo del discriminated union de
 * cerrarEjecucionAction → UI (ok + push/refresh, calendarWarning, EXEC_INCOMPLETE,
 * BILLING_GATED, INVALID_INPUT). El SignaturePad se mockea (canvas no corre en
 * jsdom); el resto del flujo de firma se ejercita real.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CerrarInspeccionForm } from '@/app/(app)/checklists/ejecuciones/CerrarInspeccionForm';

const VALID_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const EXEC_ID = '123e4567-e89b-12d3-a456-426614174000'; // uuid válido (el schema lo exige)

const { cerrarMock, pushMock, refreshMock, toastMock } = vi.hoisted(() => ({
  cerrarMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/app/(app)/checklists/ejecuciones/actions', () => ({
  cerrarEjecucionAction: (input: unknown) => cerrarMock(input),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

// SignaturePad stub: botón "firmar" que marca la firma no-vacía + toDataURL válido.
vi.mock('@/shared/ui/signature-pad', () => ({
  SignaturePad: forwardRef(function Stub(
    { onChange }: { onChange?: (empty: boolean) => void },
    ref: React.Ref<unknown>,
  ) {
    useImperativeHandle(ref, () => ({
      clear: () => {},
      toDataURL: () => VALID_PNG,
      isEmpty: () => false,
    }));
    return (
      <button type="button" data-testid="sign-pad" onClick={() => onChange?.(false)}>
        firmar
      </button>
    );
  }),
}));

function renderForm(
  capas: { descripcion: string; prioridad: string; fecha_compromiso: string }[] = [],
) {
  return render(
    <CerrarInspeccionForm
      executionId={EXEC_ID}
      fechaInspeccionDefault="2026-06-03"
      cumplimientoPct={80}
      tieneCriticos={false}
      capas={capas}
    />,
  );
}

function fillAndSubmit() {
  fireEvent.click(screen.getByTestId('sign-pad')); // marca la firma no-vacía
  fireEvent.change(screen.getByLabelText(/Nombre del matriculado/i), {
    target: { value: 'Ing. Juan Pérez' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Cerrar y firmar inspección/i }));
}

beforeEach(() => {
  cerrarMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.info.mockReset();
});
afterEach(() => cleanup());

describe('CerrarInspeccionForm', () => {
  it('preview muestra las CAPAs a generar con su fecha', () => {
    renderForm([
      { descripcion: 'Falta matafuego', prioridad: 'alta', fecha_compromiso: '2026-07-03' },
    ]);
    expect(screen.getByText(/Falta matafuego/)).toBeInTheDocument();
    expect(screen.getByText(/Crítica/)).toBeInTheDocument();
  });

  it('ok → toast success + push al detalle + refresh', async () => {
    cerrarMock.mockResolvedValue({
      ok: true,
      executionId: EXEC_ID,
      cumplimiento_pct: 80,
      tiene_criticos_incumplidos: false,
      capaCount: 2,
    });
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(cerrarMock).toHaveBeenCalledTimes(1));
    expect(cerrarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: EXEC_ID,
        firma_base64: VALID_PNG,
        firmante_nombre: 'Ing. Juan Pérez',
      }),
    );
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/checklists/ejecuciones/${EXEC_ID}`),
    );
    expect(refreshMock).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('ok + calendarWarning → además toast.info (no fatal)', async () => {
    cerrarMock.mockResolvedValue({
      ok: true,
      executionId: EXEC_ID,
      cumplimiento_pct: 80,
      tiene_criticos_incumplidos: false,
      capaCount: 1,
      calendarWarning: 'Recordatorios pendientes.',
    });
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(toastMock.info).toHaveBeenCalled());
    expect(pushMock).toHaveBeenCalledWith(`/checklists/ejecuciones/${EXEC_ID}`);
  });

  it('EXEC_INCOMPLETE → lista los faltantes inline y NO redirige', async () => {
    cerrarMock.mockResolvedValue({
      ok: false,
      code: 'EXEC_INCOMPLETE',
      faltantes: [{ id: 'i1', texto: 'Extintores vigentes' }],
      message: 'Faltan 1 ítem(s).',
    });
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText('Extintores vigentes')).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalled();
  });

  it('BILLING_GATED → toast.error y no redirige', async () => {
    cerrarMock.mockResolvedValue({
      ok: false,
      code: 'BILLING_GATED',
      reason: 'TRIAL_EXPIRED',
      message: 'Plan expirado.',
    });
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('INVALID_INPUT en firma → setError muestra el mensaje', async () => {
    cerrarMock.mockResolvedValue({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { firma_base64: ['Firma inválida. Volvé a firmar.'] },
      message: 'Revisá los campos.',
    });
    renderForm();
    fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText('Firma inválida. Volvé a firmar.')).toBeInTheDocument(),
    );
  });
});
