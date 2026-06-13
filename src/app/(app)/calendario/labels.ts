import type { CalendarEventStatus, CalendarEventTipo } from './defaults';

/**
 * T-029 · Labels de UI (es-AR) para los enums del calendario.
 *
 * Espejados con `EVENT_TIPO_VALUES` y `EVENT_STATUS_VALUES` de `defaults.ts`.
 * Si se suma un valor al enum, TS marca el Record como incompleto y rompe el
 * build — protegido por exhaustiveness check.
 *
 * NO `'use server'` — agnostic, importable desde server y client.
 */

export const EVENT_TIPO_LABELS: Record<CalendarEventTipo, string> = {
  protocolo_anual: 'Protocolo anual',
  rgrl_anual: 'RGRL anual',
  epp_entrega: 'Entrega de EPP',
  capacitacion: 'Capacitación',
  calibracion: 'Calibración de instrumento',
  examen_medico: 'Examen médico',
  custom: 'Otro',
  accion_correctiva: 'Acción correctiva',
  rar_anual: 'RAR anual',
};

export const EVENT_STATUS_LABELS: Record<CalendarEventStatus, string> = {
  pending: 'Pendiente',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

/**
 * Devuelve `Cada N meses` o `Sin recurrencia` segun corresponda. Usado en
 * EventViewPanel (read-only) y como hint inline al lado del checkbox del
 * EventForm.
 */
export function formatRecurrence(months: number | null): string {
  if (months === null) return 'Sin recurrencia';
  if (months === 1) return 'Cada mes';
  if (months === 12) return 'Cada año';
  if (months % 12 === 0) return `Cada ${months / 12} años`;
  return `Cada ${months} meses`;
}
