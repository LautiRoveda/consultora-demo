/**
 * T-061a · ItemCard: render por response_type + payload discriminado correcto en
 * el auto-save, reveal de fecha_regularizacion en "no cumple", y numérico sin coerce.
 */
import type { TemplateItemRow } from '@/app/(app)/checklists/ejecuciones/queries';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItemCard } from '@/app/(app)/checklists/ejecuciones/ItemCard';

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));

vi.mock('@/app/(app)/checklists/ejecuciones/actions', () => ({
  saveRespuestaAction: (input: unknown) => saveMock(input),
  uploadAdjuntoAction: vi.fn(),
  deleteAdjuntoAction: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const EXEC = '00000000-0000-0000-0000-0000000000ee';

function makeItem(overrides: Partial<TemplateItemRow>): TemplateItemRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    section_id: '22222222-2222-2222-2222-222222222222',
    version_id: '33333333-3333-3333-3333-333333333333',
    consultora_id: '44444444-4444-4444-4444-444444444444',
    orden: 1,
    texto: 'Extintores señalizados',
    response_type: 'cumple_no_aplica',
    es_critico: false,
    es_requerido: true,
    referencia_normativa: null,
    config: null,
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function renderItem(item: TemplateItemRow) {
  return render(
    <ul>
      <ItemCard
        executionId={EXEC}
        item={item}
        initialRespuesta={undefined}
        initialAdjuntos={[]}
        disabled={false}
        onAnsweredChange={vi.fn()}
        onFrozen={vi.fn()}
      />
    </ul>,
  );
}

beforeEach(() => {
  saveMock.mockReset();
  saveMock.mockResolvedValue({ ok: true, respuestaId: 'r-1' });
});
afterEach(() => cleanup());

describe('ItemCard · cumple_no_aplica', () => {
  it('toggle "No cumple" guarda inmediato con el payload discriminado y revela fecha_regularizacion', async () => {
    renderItem(makeItem({ response_type: 'cumple_no_aplica' }));

    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.queryByLabelText('Fecha de regularización')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'No cumple' }));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: EXEC,
          templateItemId: makeItem({}).id,
          response_type: 'cumple_no_aplica',
          valor: 'no',
        }),
      );
    });

    // "no" revela la fecha de regularización; al setearla entra en el payload.
    const fecha = screen.getByLabelText('Fecha de regularización');
    expect(fecha).toBeInTheDocument();
    saveMock.mockClear();
    fireEvent.change(fecha, { target: { value: '2026-07-01' } });
    fireEvent.blur(fecha);

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ valor: 'no', fecha_regularizacion: '2026-07-01' }),
      );
    });
  });
});

describe('ItemCard · si_no', () => {
  it('renderiza 2 toggles y guarda valor "si"', async () => {
    renderItem(makeItem({ response_type: 'si_no' }));
    expect(screen.getAllByRole('radio')).toHaveLength(2);

    fireEvent.click(screen.getByRole('radio', { name: 'Sí' }));
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ response_type: 'si_no', valor: 'si' }),
      );
    });
  });
});

describe('ItemCard · texto', () => {
  it('guarda el texto on blur con response_type texto', async () => {
    renderItem(makeItem({ response_type: 'texto' }));
    const textarea = screen.getByLabelText('Respuesta');
    fireEvent.change(textarea, { target: { value: 'Pintura descascarada' } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ response_type: 'texto', valor: 'Pintura descascarada' }),
      );
    });
  });
});

describe('ItemCard · numerico', () => {
  it('input numérico envía valor_numerico como number (sin coerce) y vacío como null', async () => {
    renderItem(makeItem({ response_type: 'numerico' }));
    const input = screen.getByLabelText('Valor');
    expect(input).toHaveAttribute('type', 'number');

    fireEvent.change(input, { target: { value: '85' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ response_type: 'numerico', valor_numerico: 85 }),
      );
    });

    saveMock.mockClear();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ response_type: 'numerico', valor_numerico: null }),
      );
    });
  });
});
