// T-153 · Valida el wrapper de retry del `supabase start`. El 502 del edge-runtime es
// intermitente → no hay demo red→green natural; este test (mock de fallos) ES la validación.
// Comandos inyectados (start/stop/sleep) → cero Docker. El guard `isMain` del módulo evita que
// el import dispare el wrapper real.
import { describe, expect, it, vi } from 'vitest';

import { startSupabaseWithRetry } from '../../../scripts/supabase-start-retry.mjs';

// Base con sleep no-op (no esperamos de verdad) + log silenciado + backoff 0.
const opts = (over: Record<string, unknown>) => ({
  sleep: vi.fn().mockResolvedValue(undefined),
  log: vi.fn(),
  backoffMs: 0,
  ...over,
});

describe('startSupabaseWithRetry', () => {
  it('arranca al primer intento: sin stop ni sleep', async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const o = opts({ start, stop });

    const attempts = await startSupabaseWithRetry(o);

    expect(attempts).toBe(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(o.sleep).not.toHaveBeenCalled();
  });

  it('reintenta tras fallos transitorios y luego procede', async () => {
    const start = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('edge runtime 502');
      })
      .mockImplementationOnce(() => {
        throw new Error('edge runtime 502');
      })
      .mockImplementationOnce(() => {});
    const stop = vi.fn();
    const o = opts({ start, stop });

    const attempts = await startSupabaseWithRetry(o);

    expect(attempts).toBe(3);
    expect(start).toHaveBeenCalledTimes(3);
    expect(stop).toHaveBeenCalledTimes(2); // stop entre intentos, no tras el éxito
    expect(o.sleep).toHaveBeenCalledTimes(2);
  });

  it('propaga el fallo tras agotar los intentos (no cuelga)', async () => {
    const start = vi.fn(() => {
      throw new Error('502 siempre');
    });
    const stop = vi.fn();
    const o = opts({ start, stop, maxAttempts: 3 });

    await expect(startSupabaseWithRetry(o)).rejects.toThrow('502 siempre');
    expect(start).toHaveBeenCalledTimes(3);
    expect(stop).toHaveBeenCalledTimes(2); // sin stop tras el último intento fallido
  });

  it('no reintenta cuando maxAttempts=1', async () => {
    const start = vi.fn(() => {
      throw new Error('x');
    });
    const stop = vi.fn();

    await expect(startSupabaseWithRetry(opts({ start, stop, maxAttempts: 1 }))).rejects.toThrow(
      'x',
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });
});
