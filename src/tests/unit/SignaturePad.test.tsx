/**
 * T-102 · Unit tests del SignaturePad canvas component (T-061b: lift a shared/ui,
 * lo comparten EPP entregas y Checklists cierre).
 *
 * jsdom no implementa HTMLCanvasElement.getContext('2d') ni toDataURL real.
 * Mockeamos prototype methods para verificar la API contractual: render con
 * dimensiones, clear() invoca clearRect, toDataURL() devuelve string PNG.
 */
import type { SignaturePadHandle } from '@/shared/ui/signature-pad';
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SignaturePad } from '@/shared/ui/signature-pad';

type CtxMock = {
  clearRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  strokeStyle: string;
  fillStyle: string;
};

let lastCtx: CtxMock | null = null;

beforeAll(() => {
  const mockedGetContext = vi.fn((contextId: string) => {
    if (contextId !== '2d') return null;
    const ctx: CtxMock = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      strokeStyle: '#000',
      fillStyle: '#000',
    };
    lastCtx = ctx;
    return ctx as unknown as CanvasRenderingContext2D;
  });
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = mockedGetContext;

  (HTMLCanvasElement.prototype as unknown as { toDataURL: unknown }).toDataURL = vi.fn(
    () =>
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  );
});

afterEach(() => {
  cleanup();
  lastCtx = null;
});

describe('SignaturePad', () => {
  it('1. renderea canvas con dimensiones default + aria-label custom', () => {
    render(<SignaturePad ariaLabel="Firma del operario" />);
    const el = screen.getByRole('img', { name: 'Firma del operario' });
    expect(el.tagName).toBe('CANVAS');
    expect((el as HTMLCanvasElement).width).toBe(600);
    expect((el as HTMLCanvasElement).height).toBe(200);
  });

  it('2. ref.clear() invoca clearRect + reportea isEmpty=true', () => {
    const ref = createRef<SignaturePadHandle>();
    render(<SignaturePad ref={ref} />);
    expect(lastCtx?.clearRect).not.toHaveBeenCalled();

    ref.current?.clear();
    expect(lastCtx?.clearRect).toHaveBeenCalledTimes(1);
    expect(lastCtx?.clearRect).toHaveBeenCalledWith(0, 0, 600, 200);
    expect(ref.current?.isEmpty()).toBe(true);
  });

  it('3. ref.toDataURL() retorna string con prefix PNG base64', () => {
    const ref = createRef<SignaturePadHandle>();
    render(<SignaturePad ref={ref} />);
    const dataUrl = ref.current?.toDataURL() ?? '';
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrl.length).toBeGreaterThan('data:image/png;base64,'.length);
  });
});
