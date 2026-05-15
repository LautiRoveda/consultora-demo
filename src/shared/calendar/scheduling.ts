/**
 * T-028 · Helpers de scheduling para calendar reminders.
 *
 * Argentina sin DST desde 2009 → offset UTC fijo (-3). NO usamos `date-fns-tz`:
 * el offset hardcoded es mas chico, mas predecible y matchea la implementacion
 * que va a usar el cron T-031.
 *
 * `date-fns@^4.1.0` solo se usa para `addMonths` (handle correcto de fin-de-mes:
 * Jan 31 + 1 mes → Feb 28/29). El resto (sub days, sub timestamps) se computa
 * con Date.UTC para evitar sorpresas de zona del runtime (VPS Hostinger).
 */

import { addMonths, parseISO } from 'date-fns';

import { SCHEDULED_AT_SEND_HOUR_UTC } from '@/app/(app)/calendario/defaults';

/**
 * Calcula `scheduled_at` (UTC) de un reminder dado el vencimiento del evento
 * y los dias de offset.
 *
 * @param fechaVencimientoIso - YYYY-MM-DD (column SQL `date`, sin hora).
 * @param offsetDays - Dias antes del vencimiento (>= 0).
 * @returns `Date` en UTC con hora = SCHEDULED_AT_SEND_HOUR_UTC (= 12 = 09:00 ART).
 *
 * Ejemplo: `computeScheduledAtUtc('2026-08-15', 7)` → `2026-08-08T12:00:00Z`.
 */
export function computeScheduledAtUtc(fechaVencimientoIso: string, offsetDays: number): Date {
  const parts = fechaVencimientoIso.split('-').map(Number) as [number, number, number];
  const [year, month, day] = parts;
  // Date.UTC evita sorpresas de TZ del runtime — la fecha YYYY-MM-DD es local
  // del calendario civil argentino y queremos plantar la hora de envio en UTC
  // directamente.
  return new Date(Date.UTC(year, month - 1, day - offsetDays, SCHEDULED_AT_SEND_HOUR_UTC, 0, 0));
}

/**
 * Row a insertar en `calendar_event_reminders`. Tipo derivado manualmente para
 * mantener al modulo agnostic del shape de Database (evita import circular con
 * defaults.ts → @/app/(app)/calendario).
 */
export type ReminderRowToInsert = {
  event_id: string;
  consultora_id: string;
  offset_days: number;
  scheduled_at: string; // ISO 8601, lo que espera Postgres timestamptz.
};

export type ComputeReminderRowsArgs = {
  eventId: string;
  consultoraId: string;
  fechaVencimientoIso: string; // YYYY-MM-DD
  offsetDays: ReadonlyArray<number>;
  now: Date;
};

export type ComputeReminderRowsResult = {
  rows: ReminderRowToInsert[];
  /** Cantidad de offsets cuyo scheduled_at quedo en el pasado (no insertados). */
  skippedPast: number;
};

/**
 * Computa los reminders a INSERTAR para un evento, omitiendo los que cayeron
 * en el pasado.
 *
 * Discovery § 5.5: si el offset cae en el pasado (ej. consultor crea evento
 * para vencimiento en 5 dias con default offset de 30), el reminder se omite
 * silenciosamente. El comportamiento de "marcar como skipped en DB" del
 * discovery se simplifico a "no insertar la fila": evita polucion de la tabla
 * + mantiene la UNIQUE(event_id, offset_days) limpia para futuros UPDATE de
 * fecha_vencimiento que reincorporen el offset.
 */
export function computeReminderRows(args: ComputeReminderRowsArgs): ComputeReminderRowsResult {
  const rows: ReminderRowToInsert[] = [];
  let skippedPast = 0;
  for (const offset of args.offsetDays) {
    const scheduledAt = computeScheduledAtUtc(args.fechaVencimientoIso, offset);
    if (scheduledAt.getTime() < args.now.getTime()) {
      skippedPast += 1;
      continue;
    }
    rows.push({
      event_id: args.eventId,
      consultora_id: args.consultoraId,
      offset_days: offset,
      scheduled_at: scheduledAt.toISOString(),
    });
  }
  return { rows, skippedPast };
}

/**
 * Suma N meses a una fecha YYYY-MM-DD y devuelve el resultado en YYYY-MM-DD.
 *
 * Wrapping de `date-fns/addMonths` para mantener el call site grep-friendly y
 * evitar que el caller importe date-fns directo (encapsulamos la dep aca).
 *
 * Edge cases (delegados a date-fns):
 * - `Jan 31 + 1 mes` → `Feb 28` (o Feb 29 si bisiesto), no Mar 3.
 * - `Mar 31 + 1 mes` → `Apr 30`, no May 1.
 *
 * Ejemplo: `addRecurrenceMonths('2026-01-31', 1)` → `'2026-02-28'`.
 */
export function addRecurrenceMonths(fechaIso: string, months: number): string {
  // parseISO con YYYY-MM-DD interpreta como UTC midnight → addMonths preserva
  // el dia/zona consistente, y reconstruimos YYYY-MM-DD del result UTC.
  const next = addMonths(parseISO(fechaIso), months);
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
