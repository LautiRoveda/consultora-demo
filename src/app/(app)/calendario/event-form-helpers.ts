import { format } from 'date-fns';

import { computeScheduledAtUtc } from '@/shared/calendar/scheduling';

/**
 * T-029 · Helpers puros del EventForm.
 *
 * Sin `'use server'` — agnostic, importable desde client (form) y testeable.
 */

/**
 * Convierte un `Date` (en zona local del browser, que es lo que devuelve el
 * shadcn Calendar / react-day-picker) al formato `YYYY-MM-DD` del CIVIL date
 * que el user vio en el picker.
 *
 * NUNCA usar `date.toISOString().slice(0, 10)` para esto. `toISOString()`
 * convierte el Date a UTC primero — si el browser esta en UTC+12 (NZ) y el
 * user clickea "15 jun 2026", el UTC equivalente es "14 jun 2026 12:00Z" y
 * el slice devuelve "2026-06-14" (off-by-one).
 *
 * `format(d, 'yyyy-MM-dd')` lee year/month/day del Date EN ZONA LOCAL, que es
 * exactamente lo que el picker mostro al user. Sin importar el browser TZ,
 * el output matchea el dia clickeado.
 */
export function dateToCivilIso(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Inversa de `dateToCivilIso`: parsea `YYYY-MM-DD` a `Date` local del browser
 * preservando el calendar day. Util para inicializar el state del Calendar
 * desde un valor stored en DB.
 *
 * `new Date('2026-06-15')` en JS interpreta como UTC midnight → en TZ con
 * offset negativo, el `.getDate()` devuelve el dia anterior. Por eso se
 * construye con el constructor numerico que SI usa local TZ.
 */
export function civilIsoToDate(iso: string): Date {
  const parts = iso.split('-').map(Number) as [number, number, number];
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/**
 * Detecta cuales offsets de la lista cayeron en el pasado relativo al `now`,
 * dado un vencimiento. Usado por el warning inline del EventForm (ajuste 3
 * del plan T-029).
 *
 * Reusa `computeScheduledAtUtc` del backend — misma logica que el server
 * action usa para decidir cuales reminders SKIP en INSERT/UPDATE.
 *
 * @returns array de offsets (subset del input) cuyo scheduled_at < now.
 *          Vacio = ningun warning a mostrar.
 */
export function findOffsetsInPast(
  fechaVencimientoIso: string,
  offsets: ReadonlyArray<number>,
  now: Date,
): number[] {
  const inPast: number[] = [];
  for (const offset of offsets) {
    const scheduledAt = computeScheduledAtUtc(fechaVencimientoIso, offset);
    if (scheduledAt.getTime() < now.getTime()) inPast.push(offset);
  }
  return inPast;
}
