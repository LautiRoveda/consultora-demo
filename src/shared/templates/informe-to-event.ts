/**
 * T-036 · Mapping tipo informe -> tipo evento + helpers para crear vencimientos
 * desde un informe firmado.
 *
 * Usado por:
 * - publishInformeAction (silent path): cuando consultora.auto_create_event_on_sign
 *   es true, computa la config y dispara createCalendarEventAction.
 * - PostPublishEventDialog (modal path): cuando el toggle es false, prepop del
 *   form con la config recomendada (el user puede editarla antes de agendar).
 *
 * NO `'use server'`: modulo puro importado desde Server Actions Y Client
 * Components (modal). Sin side effects.
 */

import type { CalendarEventTipo, UserCreatableEventTipo } from '@/app/(app)/calendario/defaults';
import type { InformeTipo } from '@/app/(app)/informes/schema';

export type InformeToEventConfig = {
  // T-133: el mapping solo produce tipos user-creatable (el create schema ya no
  // acepta los system) — el tipo angosto lo garantiza en compile-time.
  eventTipo: UserCreatableEventTipo;
  recurrenceMonths: number;
};

/**
 * Mapping tipo informe -> config de evento default.
 *
 * Retorna null si el tipo de informe NO genera vencimiento recurrente:
 * - accidente: one-off (sucedio, se documenta, no se repite por agenda).
 * - otros: tema generico sin recurrencia clara.
 *
 * Mapping basado en discovery seccion 4 (tipos de eventos / vencimientos):
 * - rgrl -> rgrl_anual: presentacion anual ante ART, Res SRT 463/09.
 * - relevamiento -> protocolo_anual: protocolos tecnicos (ruido, iluminacion,
 *   puesta a tierra, carga de fuego). 12 meses por Decreto 351/79 Anexo V.
 * - capacitacion -> capacitacion: capacitaciones HyS reglamentarias 12 meses.
 */
export function mapInformeTipoToEventoConfig(tipo: InformeTipo): InformeToEventConfig | null {
  switch (tipo) {
    case 'rgrl':
      return { eventTipo: 'rgrl_anual', recurrenceMonths: 12 };
    case 'relevamiento':
      return { eventTipo: 'protocolo_anual', recurrenceMonths: 12 };
    case 'capacitacion':
      return { eventTipo: 'capacitacion', recurrenceMonths: 12 };
    case 'accidente':
    case 'otros':
      return null;
    default: {
      // Defense exhaustive check: si se agrega un InformeTipo nuevo, TS forza
      // al dev a sumarlo aca o ajustar el mapping.
      const _exhaustive: never = tipo;
      throw new Error(`Unhandled informe tipo: ${String(_exhaustive)}`);
    }
  }
}

const EVENT_TIPO_PREFIX: Record<CalendarEventTipo, string> = {
  rgrl_anual: 'RGRL anual',
  protocolo_anual: 'Protocolo anual',
  capacitacion: 'Capacitacion',
  epp_entrega: 'EPP',
  calibracion: 'Calibracion',
  examen_medico: 'Examen medico',
  custom: '',
  accion_correctiva: 'Accion correctiva',
  rar_anual: 'RAR anual',
};

/**
 * Default titulo del evento desde el informe + metadata (si existe).
 *
 * Si hay razon_social del informe_metadata -> "<EventLabel> · <razon_social>".
 * Si no hay metadata -> informe.titulo (el user puede editarlo en el modal).
 *
 * Tipo `custom` no tiene prefix predefinido: fallback al titulo del informe.
 */
export function buildDefaultEventoTitulo(args: {
  informeTitulo: string;
  razonSocial: string | null;
  eventTipo: CalendarEventTipo;
}): string {
  const prefix = EVENT_TIPO_PREFIX[args.eventTipo];
  if (args.razonSocial && prefix) {
    return `${prefix} · ${args.razonSocial}`;
  }
  return args.informeTitulo;
}
