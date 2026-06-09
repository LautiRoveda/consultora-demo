/**
 * T-061a · useAutoSaveRespuesta: debounce coalesce (latest-wins), guardado
 * inmediato (toggles), flush devuelve respuestaId, EXEC_NOT_DRAFT → onFrozen.
 */
import type { SaveRespuestaInput } from '@/app/(app)/checklists/ejecuciones/schema';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoSaveRespuesta } from '@/app/(app)/checklists/ejecuciones/useAutoSaveRespuesta';

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));

vi.mock('@/app/(app)/checklists/ejecuciones/actions', () => ({
  saveRespuestaAction: (input: unknown) => saveMock(input),
}));

const EXEC = '00000000-0000-0000-0000-0000000000ee';
const ITEM = '11111111-1111-1111-1111-111111111111';

function payload(valor: 'si' | 'no'): SaveRespuestaInput {
  return {
    executionId: EXEC,
    templateItemId: ITEM,
    response_type: 'cumple_no_aplica',
    valor,
  };
}

beforeEach(() => {
  saveMock.mockReset();
  saveMock.mockResolvedValue({ ok: true, respuestaId: 'r-1' });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useAutoSaveRespuesta', () => {
  it('debounce coalesce: varios schedule en la ventana → un solo save con el último payload', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useAutoSaveRespuesta({ initialRespuestaId: null, onFrozen: vi.fn(), debounceMs: 800 }),
    );

    act(() => {
      result.current.schedule(payload('si'));
      result.current.schedule(payload('no'));
    });
    expect(saveMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ valor: 'no' }));
  });

  it('immediate: el toggle guarda al instante sin esperar el debounce', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useAutoSaveRespuesta({ initialRespuestaId: null, onFrozen: vi.fn() }),
    );
    act(() => {
      result.current.schedule(payload('si'), { immediate: true });
    });
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('flush resuelve con el respuestaId del save', async () => {
    saveMock.mockResolvedValue({ ok: true, respuestaId: 'r-9' });
    const { result } = renderHook(() =>
      useAutoSaveRespuesta({ initialRespuestaId: null, onFrozen: vi.fn() }),
    );
    let id: string | null = null;
    await act(async () => {
      id = await result.current.flush(payload('si'));
    });
    expect(id).toBe('r-9');
  });

  it('EXEC_NOT_DRAFT → onFrozen + status error', async () => {
    saveMock.mockResolvedValue({ ok: false, code: 'EXEC_NOT_DRAFT', message: 'no editable' });
    const onFrozen = vi.fn();
    const { result } = renderHook(() =>
      useAutoSaveRespuesta({ initialRespuestaId: null, onFrozen }),
    );
    await act(async () => {
      await result.current.flush(payload('si'));
    });
    await waitFor(() => expect(onFrozen).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe('error');
  });
});
