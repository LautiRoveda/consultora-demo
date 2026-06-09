/**
 * T-117-FU3 · Mapa nombre_de_tool → label legible para el chip de estado del chat.
 *
 * El orquestador SSE emite el `name` crudo de la tool (evento `tool`); el label y
 * su localizacion viven acá, en el cliente. Mantiene el contrato del wire estable
 * (no dependemos de strings de UI en el server).
 *
 * Escala: cuando el registry de tools se generalice (Tanda 2: Checklists /
 * Calendario / Incidentes), sumá las entradas nuevas acá. Las tools sin label
 * caen al fallback genérico — nunca rompen el chip.
 */
const TOOL_LABELS: Record<string, string> = {
  buscar_empleado: 'Buscando empleado…',
  epp_entregado_a_empleado: 'Consultando entregas de EPP…',
  vencimientos_epp_de_empleado: 'Revisando vencimientos del empleado…',
  vencimientos_epp_proximos: 'Revisando vencimientos próximos…',
};

const TOOL_LABEL_FALLBACK = 'Consultando datos…';

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? TOOL_LABEL_FALLBACK;
}
