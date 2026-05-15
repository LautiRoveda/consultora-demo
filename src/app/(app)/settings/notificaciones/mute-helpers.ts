import type { MuteInput } from './schema';

/**
 * T-035 · Helpers puros del mute temporal. Sin `'use server'` — testeable
 * sin DB, importable desde client (preview) y server (action).
 */

/**
 * Computa el `muted_until` (ISO string UTC) a partir del input del form.
 *
 * TZ para `until`: UTC end-of-day (23:59:59.000Z) del dia seleccionado.
 * Razon: el dispatcher T-031 hace `new Date(muted_until) > now` (comparacion
 * UTC directa) y el cron procesa a 12:00 UTC = 09:00 ART. Si user setea
 * "muteado hasta 15/05", lo correcto es que el cron del 15/05 a 12:00 UTC
 * caiga adentro del rango muteado → `muted_until = 2026-05-15T23:59:59Z`
 * lo cubre. El cron del 16/05 a 12:00 UTC ya esta fuera del rango → user
 * vuelve a recibir. Coincide con la intuicion "muteado hasta el dia N
 * inclusive".
 *
 * ART end-of-day (= 02:59:59 UTC del dia siguiente) daria +3h extra que NO
 * cambia el comportamiento practico del cron pero suma complejidad sin valor.
 *
 * Para `days`: now + days*24h exactos. UX "mute por una semana" = 7*24h
 * desde el click, sin alinear a calendar boundaries.
 */
export function computeMutedUntil(input: MuteInput, now: Date): string | null {
  if (input.type === 'none') return null;
  if (input.type === 'days') {
    const ms = now.getTime() + input.days * 24 * 60 * 60 * 1000;
    return new Date(ms).toISOString();
  }
  return `${input.date}T23:59:59.000Z`;
}

export type MuteStatus = { state: 'active' } | { state: 'paused'; untilIso: string };

/**
 * Estado del mute para mostrar en UI. El mute es global por scope T-035
 * (UPSERT bulk a los 3 canales), pero leemos los rows independientes y
 * computamos el "estado efectivo": si CUALQUIER canal tiene `muted_until`
 * futuro → paused. Tomamos el MAS LEJANO para mostrar la fecha de fin.
 *
 * Rows con `muted_until` pasado o null se ignoran (el dispatcher tambien los
 * trata como no-mute via `new Date(muted_until) > now`).
 */
export function getMuteStatus(
  prefs: ReadonlyArray<{ muted_until: string | null }>,
  now: Date,
): MuteStatus {
  const futures = prefs
    .map((p) => p.muted_until)
    .filter((u): u is string => u !== null && new Date(u).getTime() > now.getTime());
  if (futures.length === 0) return { state: 'active' };
  futures.sort();
  // length>0 garantiza el ultimo elemento; el cast es defensivo contra
  // noUncheckedIndexedAccess.
  return { state: 'paused', untilIso: futures[futures.length - 1] as string };
}
