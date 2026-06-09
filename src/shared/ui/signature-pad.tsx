'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 200;
const STROKE_COLOR = '#0f172a'; // slate-900
const STROKE_WIDTH = 2;

export type SignaturePadHandle = {
  clear: () => void;
  toDataURL: () => string;
  isEmpty: () => boolean;
};

export type SignaturePadProps = {
  width?: number;
  height?: number;
  ariaLabel?: string;
  onChange?: (isEmpty: boolean) => void;
};

/**
 * Canvas HTML5 nativo para captura de firma (T-102, lift a shared en T-061b:
 * lo comparten EPP entregas y Checklists cierre).
 *
 * Sin librería externa: el mismo dibujo se obtiene con ~80 líneas y evita
 * dependency tree. Touch-friendly (mobile-first): preventDefault en los
 * pointer events evita scroll mientras se firma.
 *
 * API ref imperativa: clear(), toDataURL(), isEmpty(). El consumer (form/wizard)
 * llama toDataURL() al submit final.
 *
 * No es responsive por width/height de container — usa props fijas (ergonomía
 * estable en mobile y desktop; el caller maneja la cobertura visual con CSS
 * max-width del wrapper).
 */
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, ariaLabel, onChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const notifyChange = useCallback(
    (empty: boolean) => {
      setIsEmpty(empty);
      onChange?.(empty);
    },
    [onChange],
  );

  const getContext = useCallback((): CanvasRenderingContext2D | null => {
    return canvasRef.current?.getContext('2d') ?? null;
  }, []);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    notifyChange(true);
  }, [getContext, notifyChange]);

  const toDataURL = useCallback((): string => {
    const canvas = canvasRef.current;
    if (!canvas) return '';
    return canvas.toDataURL('image/png');
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      clear,
      toDataURL,
      isEmpty: () => isEmpty,
    }),
    [clear, toDataURL, isEmpty],
  );

  // Setup ctx defaults una vez al mount (lineWidth + lineCap + strokeStyle).
  useEffect(() => {
    const ctx = getContext();
    if (!ctx) return;
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = STROKE_COLOR;
  }, [getContext]);

  const getPointFromEvent = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const point = getPointFromEvent(e);
      if (!point) return;
      try {
        canvasRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture puede tirar (InvalidStateError) con punteros sintéticos
        // (p.ej. el mouse de Playwright en E2E). El trazo no depende de la captura
        // —solo mantiene el move si el puntero sale del canvas— así que seguimos.
      }
      isDrawingRef.current = true;
      lastPointRef.current = point;

      const ctx = getContext();
      if (ctx) {
        // Marca punto inicial (para taps cortos que no generan move events).
        ctx.beginPath();
        ctx.arc(point.x, point.y, STROKE_WIDTH / 2, 0, Math.PI * 2);
        ctx.fillStyle = STROKE_COLOR;
        ctx.fill();
      }
      notifyChange(false);
    },
    [getContext, getPointFromEvent, notifyChange],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();
      const point = getPointFromEvent(e);
      const last = lastPointRef.current;
      const ctx = getContext();
      if (!point || !last || !ctx) return;

      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      lastPointRef.current = point;
    },
    [getContext, getPointFromEvent],
  );

  const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // releasePointerCapture lanza si no hay capture activo; ignorable.
    }
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel ?? 'Pad para firmar'}
      width={width}
      height={height}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      className="block w-full max-w-full touch-none rounded-md border border-input bg-background"
      style={{ aspectRatio: `${width} / ${height}` }}
    />
  );
});
