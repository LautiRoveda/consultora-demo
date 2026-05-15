import type { CalendarEventRow } from './queries';

/**
 * T-030 · Helper puro: agrupa eventos en buckets temporales relativos a `now`.
 *
 * Sin `'use server'` / `'server-only'` — agnostic, testeable, reusable desde:
 *  - AgendaView (client) para renderizar las 4 secciones,
 *  - ProximosVencimientosPanel (server, dashboard) para counts + "mas urgente".
 *
 * Bordes inclusive/exclusive (cada dia cae en EXACTAMENTE un bucket):
 *  - hoy:         fecha <= todayIso  (incluye overdue ya vencidos + today)
 *  - siete:       todayIso < fecha <= todayIso+7
 *  - treinta:     todayIso+7 < fecha <= todayIso+30
 *  - masAdelante: fecha > todayIso+30
 *
 * Sort intra-bucket: fecha ASC + id ASC (estable, mismo criterio que T-029
 * `getCalendarEventsForConsultora`).
 *
 * Solo procesa eventos con `status='pending'` — completed/cancelled NO entran
 * (silent drop). El caller del modo `flat` de AgendaView no usa este helper.
 *
 * TZ caveat: usamos UTC para sumar dias al `todayIso`. Para un consultor
 * argentino (UTC-3), durante las horas 21:00-23:59 ART el `today` en UTC ya
 * es day+1 → un evento con fecha=hoy-ART puede leerse como "ayer" desde UTC.
 * MVP acceptable porque `fecha_vencimiento` es civil date sin hora y el cron
 * T-031 envia reminders a 09:00 ART (12:00 UTC). Revisar en T-028-FU3 cuando
 * llegue TZ per-consultora.
 */

export type AgendaBuckets = {
  /** overdue (fecha < today) + today, todos pending. Sort ASC. */
  hoy: CalendarEventRow[];
  /** today < fecha <= today+7, pending. Sort ASC. */
  siete: CalendarEventRow[];
  /** today+7 < fecha <= today+30, pending. Sort ASC. */
  treinta: CalendarEventRow[];
  /** fecha > today+30, pending. Sort ASC. */
  masAdelante: CalendarEventRow[];
};

function toIsoUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Suma N dias (positivo o negativo) a un YYYY-MM-DD respetando rollover de
 * mes y anio en UTC. Exportado para tests; el caller normal lo usa via
 * `groupEventsByBucket`.
 */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIsoUtc(dt);
}

function compareEvents(a: CalendarEventRow, b: CalendarEventRow): number {
  if (a.fecha_vencimiento !== b.fecha_vencimiento) {
    return a.fecha_vencimiento < b.fecha_vencimiento ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function groupEventsByBucket(
  events: ReadonlyArray<CalendarEventRow>,
  now: Date,
): AgendaBuckets {
  const todayIso = toIsoUtc(now);
  const plus7 = addDaysIso(todayIso, 7);
  const plus30 = addDaysIso(todayIso, 30);

  const hoy: CalendarEventRow[] = [];
  const siete: CalendarEventRow[] = [];
  const treinta: CalendarEventRow[] = [];
  const masAdelante: CalendarEventRow[] = [];

  for (const ev of events) {
    if (ev.status !== 'pending') continue;
    const f = ev.fecha_vencimiento;
    if (f <= todayIso) hoy.push(ev);
    else if (f <= plus7) siete.push(ev);
    else if (f <= plus30) treinta.push(ev);
    else masAdelante.push(ev);
  }

  hoy.sort(compareEvents);
  siete.sort(compareEvents);
  treinta.sort(compareEvents);
  masAdelante.sort(compareEvents);

  return { hoy, siete, treinta, masAdelante };
}
