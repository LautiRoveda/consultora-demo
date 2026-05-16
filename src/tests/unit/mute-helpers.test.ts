/**
 * T-035 · Tests del helper mute-helpers.
 *
 * Helpers puros: testeamos los 3 branches de computeMutedUntil (none/days/until)
 * + edge cases de getMuteStatus (active / paused / mixed expirados).
 */
import { describe, expect, it } from 'vitest';

import { computeMutedUntil, getMuteStatus } from '@/app/(app)/settings/notificaciones/mute-helpers';

function fixedNow(): Date {
  // 2026-05-15 14:00:00 UTC (11:00 ART, dentro del horario laboral)
  return new Date('2026-05-15T14:00:00.000Z');
}

describe('computeMutedUntil', () => {
  it('type=none devuelve null', () => {
    expect(computeMutedUntil({ type: 'none' }, fixedNow())).toBeNull();
  });

  it('type=days days=7 devuelve ISO de now + 7*24h exactos', () => {
    const result = computeMutedUntil({ type: 'days', days: 7 }, fixedNow());
    expect(result).toBe('2026-05-22T14:00:00.000Z');
  });

  it('type=days days=14 devuelve ISO de now + 14*24h exactos', () => {
    const result = computeMutedUntil({ type: 'days', days: 14 }, fixedNow());
    expect(result).toBe('2026-05-29T14:00:00.000Z');
  });

  it('type=until devuelve UTC end-of-day del dia seleccionado', () => {
    const result = computeMutedUntil({ type: 'until', date: '2026-05-22' }, fixedNow());
    expect(result).toBe('2026-05-22T23:59:59.000Z');
  });

  it('type=until preserva el dia seleccionado sin importar el now', () => {
    // El `until` no depende de `now` — siempre es 23:59:59Z del dia.
    const nowFar = new Date('2025-01-01T00:00:00.000Z');
    const result = computeMutedUntil({ type: 'until', date: '2027-12-31' }, nowFar);
    expect(result).toBe('2027-12-31T23:59:59.000Z');
  });
});

describe('getMuteStatus', () => {
  it('todos los prefs sin muted_until devuelve active', () => {
    const result = getMuteStatus(
      [{ muted_until: null }, { muted_until: null }, { muted_until: null }],
      fixedNow(),
    );
    expect(result).toEqual({ state: 'active' });
  });

  it('1 pref futuro devuelve paused con esa fecha', () => {
    const result = getMuteStatus(
      [{ muted_until: null }, { muted_until: '2026-05-22T23:59:59.000Z' }, { muted_until: null }],
      fixedNow(),
    );
    expect(result).toEqual({ state: 'paused', untilIso: '2026-05-22T23:59:59.000Z' });
  });

  it('todos los prefs con muted_until pasado devuelve active (ignora expirados)', () => {
    const result = getMuteStatus(
      [
        { muted_until: '2026-05-10T00:00:00.000Z' },
        { muted_until: '2026-05-14T00:00:00.000Z' },
        { muted_until: null },
      ],
      fixedNow(),
    );
    expect(result).toEqual({ state: 'active' });
  });

  it('multiples prefs futuros toma el mas lejano (sort ascendente)', () => {
    const result = getMuteStatus(
      [
        { muted_until: '2026-05-20T23:59:59.000Z' },
        { muted_until: '2026-06-01T23:59:59.000Z' },
        { muted_until: '2026-05-22T23:59:59.000Z' },
      ],
      fixedNow(),
    );
    expect(result).toEqual({ state: 'paused', untilIso: '2026-06-01T23:59:59.000Z' });
  });

  it('mix de pasado + futuro ignora el pasado', () => {
    const result = getMuteStatus(
      [
        { muted_until: '2026-05-10T00:00:00.000Z' }, // pasado
        { muted_until: '2026-05-22T23:59:59.000Z' }, // futuro
        { muted_until: null },
      ],
      fixedNow(),
    );
    expect(result).toEqual({ state: 'paused', untilIso: '2026-05-22T23:59:59.000Z' });
  });

  it('lista vacia devuelve active', () => {
    expect(getMuteStatus([], fixedNow())).toEqual({ state: 'active' });
  });
});
