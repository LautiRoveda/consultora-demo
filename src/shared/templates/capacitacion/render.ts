import type { CapacitacionMetadata } from './schema';

import {
  renderCamposPersonalizadosBlock,
  renderEstructuraSolicitadaBlock,
  renderInstruccionesAdicionalesBlock,
} from '../common/render-extra';
import { renderAsBlockquote, sanitizeField } from '../common/sanitize';
import { modalidadCapacitacionLabel } from './schema';
import { SECCION_LABEL_BY_ID_CAPACITACION } from './secciones';

/**
 * T-022 · Render del metadata Capacitacion como bloque markdown estructurado
 * para inyectar al `user message` del Claude API call.
 *
 * Mismo contrato que `renderRgrlMetadataAsPromptContext` (T-021):
 *  - Header `## Datos de la capacitacion (proporcionados por el consultor)`.
 *  - Bloques tematicos con `**bold labels**`.
 *  - `sanitizeField()` sobre todo string user-controlled.
 *  - Opcionales ausentes NO se renderizan.
 *  - Footer de re-anclaje al rol del modelo.
 */
export function renderCapacitacionMetadataAsPromptContext(metadata: CapacitacionMetadata): string {
  const m = metadata;
  const modalidad = modalidadCapacitacionLabel(m.modalidad);
  const horasFormat = formatHoras(m.duracion_horas);

  const lines: string[] = [];

  lines.push('## Datos de la capacitación (proporcionados por el consultor)');
  lines.push('');

  // Cliente
  lines.push('**Cliente:**');
  lines.push(`- Razón social: ${sanitizeField(m.razon_social)}`);
  lines.push(`- CUIT: ${m.cuit}`);
  lines.push(`- Domicilio: ${sanitizeField(m.domicilio)}`);
  lines.push('');

  // Actividad formativa
  lines.push('**Actividad formativa:**');
  lines.push(`- Tema principal: ${sanitizeField(m.tema_principal)}`);
  lines.push(`- Modalidad: ${modalidad}`);
  lines.push(`- Duración: ${horasFormat}`);
  lines.push(`- Fecha: ${m.fecha_capacitacion}`);
  const capacitador = m.capacitador_matricula
    ? `${sanitizeField(m.capacitador_nombre)} (Matrícula: ${sanitizeField(m.capacitador_matricula)})`
    : sanitizeField(m.capacitador_nombre);
  lines.push(`- Capacitador: ${capacitador}`);
  lines.push(`- Asistentes previstos: ${m.cantidad_asistentes_prevista}`);
  lines.push('');

  // Contenidos resumidos (opcional)
  if (m.contenidos_resumen) {
    lines.push('**Contenidos resumidos (entrada del consultor):**');
    lines.push(renderAsBlockquote(sanitizeField(m.contenidos_resumen)));
    lines.push('');
  }

  // T-138 · Personalizacion (campos → estructura → instrucciones), siempre
  // ANTES del footer de re-anclaje: la ultima palabra la tiene el sistema.
  lines.push(...renderCamposPersonalizadosBlock(m.campos_personalizados));
  lines.push(...renderEstructuraSolicitadaBlock(m.secciones, SECCION_LABEL_BY_ID_CAPACITACION));
  lines.push(...renderInstruccionesAdicionalesBlock(m.instrucciones_adicionales));

  // Footer de re-anclaje
  lines.push('---');
  lines.push('');
  lines.push(
    'Generá el informe de capacitación siguiendo la estructura de tus instrucciones. Usá los datos de arriba en lugar de placeholders "[A COMPLETAR]". Mantené placeholders solo para datos que NO te di (orden del día minuto a minuto, evaluación final, listado nominal de asistentes, firma del capacitador).',
  );

  return lines.join('\n');
}

/**
 * Formato es-AR de horas: "2 horas" si entero, "2,5 horas" si decimal.
 * Cap superior 40h del schema acota el rango — sin pluralizacion para 1 hora
 * (caso edge donde "1 hora" se diferencia de "2 horas" — gestionado).
 */
function formatHoras(h: number): string {
  if (Number.isInteger(h)) {
    return h === 1 ? '1 hora' : `${h} horas`;
  }
  // Decimal: coma decimal AR.
  const fmt = h.toString().replace('.', ',');
  return `${fmt} horas`;
}
