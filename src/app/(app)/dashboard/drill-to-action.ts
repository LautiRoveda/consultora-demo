import type { CalendarEventTipo } from '../calendario/defaults';
import type { CalendarEventRow } from '../calendario/queries';

/**
 * T-131 · Mapa puro `tipo de evento` → CTA "drill-to-action" del dashboard.
 *
 * Cada vencimiento de la cola "Lo que necesita tu atención" termina en un CTA
 * que dispara el pilar correspondiente cuando existe. Decisión del owner
 * (T-131 fase A): SOLO `epp_entrega` y `protocolo_anual` disparan un pilar; el
 * resto linkea al detalle del evento en la agenda ("Ver en agenda"), sin
 * prometer una acción que no existe.
 *
 * El `Record` es exhaustivo: si se suma un valor a `CalendarEventTipo`, TS marca
 * el mapa como incompleto y rompe el build (mismo molde que `EVENT_TIPO_LABELS`).
 *
 * Sin `'use server'` / `'server-only'`: módulo agnostic, testeable y reusable.
 */

export type DrillAction = {
  label: string;
  href: string;
  /** 'pilar' = dispara un pilar (CTA primario); 'agenda' = ver el evento. */
  kind: 'pilar' | 'agenda';
};

type EventForDrill = Pick<CalendarEventRow, 'id' | 'tipo'>;

/** Tipos sin acción de pilar → al detalle del evento (drawer de la agenda). */
function verEnAgenda(ev: EventForDrill): DrillAction {
  return { label: 'Ver en agenda', href: `/calendario/agenda?event=${ev.id}`, kind: 'agenda' };
}

const DRILL: Record<CalendarEventTipo, (ev: EventForDrill) => DrillAction> = {
  epp_entrega: () => ({
    label: 'Generar planilla Res 299/11',
    href: '/epp/entregas/nueva',
    kind: 'pilar',
  }),
  protocolo_anual: () => ({
    label: 'Generar informe con IA',
    href: '/informes/nuevo',
    kind: 'pilar',
  }),
  // Fase B (no se actúa ahora): rgrl_anual también es un informe → promovible a
  // "Generar informe con IA"; accion_correctiva → la CAPA en /checklists/ejecuciones.
  rgrl_anual: verEnAgenda,
  capacitacion: verEnAgenda,
  calibracion: verEnAgenda,
  examen_medico: verEnAgenda,
  custom: verEnAgenda,
  accion_correctiva: verEnAgenda,
  // T-146: el vencimiento del RAR linkea a la agenda en 3a. RAR Fase 3b podrá
  // promoverlo a un pilar ("Marcar como presentado" en /rar/planilla).
  rar_anual: verEnAgenda,
};

export function drillToAction(ev: EventForDrill): DrillAction {
  const resolver = DRILL[ev.tipo as CalendarEventTipo] ?? verEnAgenda;
  return resolver(ev);
}
