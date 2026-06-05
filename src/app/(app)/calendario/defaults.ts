/**
 * T-028 · Constantes del modulo Calendario.
 *
 * Las listas de literales son espejo TS de los CHECK constraints definidos en
 * `supabase/migrations/20260514125515_calendar_events.sql` (T-027). Mantenerlas
 * en sync — el test `calendar-events-rls.test.ts` ya cubre que la DB rechaza
 * valores fuera de spec.
 *
 * NO `'use server'`: este modulo es agnostic y se importa desde Client (RHF +
 * zodResolver en T-029) y Server (actions + queries).
 */

export const EVENT_TIPO_VALUES = [
  'protocolo_anual',
  'epp_entrega',
  'capacitacion',
  'calibracion',
  'examen_medico',
  'rgrl_anual',
  'custom',
  // T-057 · acción correctiva RGRL. SYSTEM-GENERATED (la RPC gen_acciones_calendar_for
  // crea el evento al cerrar una inspección) → NO se ofrece en el dropdown manual de
  // EventForm. Espejo del CHECK calendar_events.tipo (migración t057_checklists).
  'accion_correctiva',
] as const;
export type CalendarEventTipo = (typeof EVENT_TIPO_VALUES)[number];

export const EVENT_STATUS_VALUES = ['pending', 'completed', 'cancelled'] as const;
export type CalendarEventStatus = (typeof EVENT_STATUS_VALUES)[number];

// Espejo del CHECK calendar_event_reminders.status (migración calendar_events, estrechado
// en T-124). 'failed' se quitó en T-124: nunca se escribió — el fallo de envío vive en
// notification_log, no en el reminder. Ciclo real: pending -> sent (cron) | skipped (trigger T-123).
export const REMINDER_STATUS_VALUES = ['pending', 'sent', 'skipped'] as const;
export type CalendarEventReminderStatus = (typeof REMINDER_STATUS_VALUES)[number];

/**
 * Defaults de offsets (en dias) por tipo de evento. Usados cuando el caller no
 * provee un override explicito en `reminder_offsets_days`.
 *
 * Justificacion de los valores en docs/discovery/07-calendario-notificaciones.md
 * § 4-5. Highlights:
 * - RGRL [60,30,7,0]: muy critico legalmente; 60d permite coordinar fecha con
 *   la ART.
 * - EPP [14,3,0]: la entrega es a 6 meses; 14d permite comprar stock + agendar.
 * - Calibracion [60,14,0]: requiere mandar el equipo a laboratorio externo
 *   (turnos largos).
 * - Custom [7,0]: vencimientos one-off del consultor.
 */
export const DEFAULT_REMINDER_OFFSETS_BY_TYPE: Record<CalendarEventTipo, readonly number[]> = {
  protocolo_anual: [30, 7, 0],
  rgrl_anual: [60, 30, 7, 0],
  epp_entrega: [14, 3, 0],
  capacitacion: [30, 7, 0],
  calibracion: [60, 14, 0],
  examen_medico: [30, 7, 0],
  custom: [7, 0],
  // accion_correctiva [30,7,0]: la fecha_compromiso es un plazo de regularización
  // comprometido; 30d permite coordinar la corrección. La RPC los inyecta en
  // calendar_event_reminders (T-057).
  accion_correctiva: [30, 7, 0],
};

/**
 * Hora de envio de notificaciones en zona Argentina (UTC-3 fijo, sin DST desde
 * 2009). Hardcoded MVP — setting per-consultora llega cuando entren tenants
 * Chile/Uruguay (Fase 5, follow-up T-028-FU3).
 */
export const SCHEDULED_AT_SEND_HOUR_LOCAL = 9; // 09:00 ART
export const ARGENTINA_UTC_OFFSET_HOURS = -3;
export const SCHEDULED_AT_SEND_HOUR_UTC = SCHEDULED_AT_SEND_HOUR_LOCAL - ARGENTINA_UTC_OFFSET_HOURS; // = 12 → 09:00 ART = 12:00 UTC

/**
 * Bounds de validacion. Espejo de los CHECK constraints SQL.
 */
export const TITULO_MIN_LENGTH = 3;
export const TITULO_MAX_LENGTH = 200;
export const DESCRIPCION_MAX_LENGTH = 2000;
export const RECURRENCE_MONTHS_MIN = 1;
export const RECURRENCE_MONTHS_MAX = 60;
export const OFFSET_DAYS_MIN = 0;
export const OFFSET_DAYS_MAX = 365;
export const REMINDER_OFFSETS_MAX_COUNT = 6;
export const CANCEL_REASON_MAX_LENGTH = 500;
