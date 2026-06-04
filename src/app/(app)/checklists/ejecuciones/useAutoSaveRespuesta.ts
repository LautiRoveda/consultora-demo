'use client';

import type { SaveRespuestaInput } from './schema';
import { useCallback, useEffect, useRef, useState } from 'react';

import { saveRespuestaAction } from './actions';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * T-061a · Auto-save por ítem, tolerante a cortes de red (sin offline duro).
 *
 * - Toggles → `schedule(payload, { immediate: true })` (guardan al instante).
 * - Texto/numérico/observación → `schedule(payload)` debounced (default 800ms) + on blur.
 * - Dedupe in-flight + latest-wins: si llegan varios saves del mismo ítem, solo el
 *   último payload se persiste y solo el último resultado dicta el status.
 * - Devuelve el `respuestaId` (lo usa la foto para atarse al hallazgo). `flush()`
 *   fuerza el guardado pendiente y resuelve con el id (lo usa PhotoCapture antes de subir).
 * - `EXEC_NOT_DRAFT` → `onFrozen()` (el runner pasa a read-only).
 */
export function useAutoSaveRespuesta(opts: {
  initialRespuestaId: string | null;
  onFrozen: () => void;
  debounceMs?: number;
}) {
  const { initialRespuestaId, onFrozen, debounceMs = 800 } = opts;
  const [status, setStatus] = useState<SaveStatus>('idle');

  const respuestaIdRef = useRef<string | null>(initialRespuestaId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const lastPayloadRef = useRef<SaveRespuestaInput | null>(null);
  const onFrozenRef = useRef(onFrozen);
  useEffect(() => {
    onFrozenRef.current = onFrozen;
  }, [onFrozen]);

  const runSave = useCallback(async (payload: SaveRespuestaInput): Promise<string | null> => {
    const seq = (seqRef.current += 1);
    setStatus('saving');
    const result = await saveRespuestaAction(payload);
    const isLatest = seq === seqRef.current;

    if (result.ok) {
      respuestaIdRef.current = result.respuestaId;
      if (isLatest) setStatus('saved');
      return result.respuestaId;
    }
    if (result.code === 'EXEC_NOT_DRAFT') {
      onFrozenRef.current();
      if (isLatest) setStatus('error');
      return null;
    }
    // NOT_FOUND / INVALID_INPUT / INTERNAL_ERROR / AccessFailure → error reintentale, no bloquea.
    if (isLatest) setStatus('error');
    return null;
  }, []);

  const flush = useCallback(
    async (payload?: SaveRespuestaInput): Promise<string | null> => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const p = payload ?? lastPayloadRef.current;
      if (!p) return respuestaIdRef.current;
      lastPayloadRef.current = p;
      return runSave(p);
    },
    [runSave],
  );

  const schedule = useCallback(
    (payload: SaveRespuestaInput, options?: { immediate?: boolean }) => {
      lastPayloadRef.current = payload;
      if (timerRef.current) clearTimeout(timerRef.current);
      setStatus('saving');
      if (options?.immediate) {
        void runSave(payload);
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const p = lastPayloadRef.current;
        if (p) void runSave(p);
      }, debounceMs);
    },
    [debounceMs, runSave],
  );

  const retry = useCallback(() => {
    const p = lastPayloadRef.current;
    if (p) void runSave(p);
  }, [runSave]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return {
    status,
    schedule,
    flush,
    retry,
    getRespuestaId: () => respuestaIdRef.current,
  };
}
