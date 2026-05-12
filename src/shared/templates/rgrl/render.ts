import type { RgrlMetadata } from './schema';

import { renderAsBlockquote, sanitizeField } from '../common/sanitize';
import { provinciaName } from '../common/site';
import {
  distribucionTurnoLabel,
  modalidadOperativaLabel,
  servicioHysModalidadLabel,
} from './schema';

/**
 * T-021 · Render del metadata RGRL como bloque markdown estructurado para
 * inyectar en el `user message` del Claude API call.
 *
 * T-022 · `sanitizeField` y `renderAsBlockquote` se importan de `common/sanitize`
 * — los 5 renders comparten la misma defensa anti-prompt-injection.
 *
 * Diseno:
 * - El bloque se prepende al userMessage. El `system` prompt no cambia →
 *   los hits de prompt caching (cache_control: ephemeral) se preservan.
 * - Los valores del consultor se escapan ANTES de concatenarse al template
 *   fijo. Estrategia defensiva contra prompt-injection.
 * - Footer de re-anclaje: el ultimo parrafo re-instruye al modelo a su rol
 *   original. Defensa contra jailbreaks por inyeccion.
 * - Campos opcionales ausentes: NO se renderizan.
 */
export function renderRgrlMetadataAsPromptContext(metadata: RgrlMetadata): string {
  const m = metadata;
  const provincia = `${provinciaName(m.provincia)} (${m.provincia})`;
  const turno = distribucionTurnoLabel(m.distribucion_turno);
  const modalidad = modalidadOperativaLabel(m.modalidad_operativa);
  const servicio = servicioHysModalidadLabel(m.servicio_hys_modalidad);

  const lines: string[] = [];

  lines.push('## Datos del establecimiento (proporcionados por el consultor)');
  lines.push('');

  // Identificacion
  lines.push('**Identificación:**');
  lines.push(`- Razón social: ${sanitizeField(m.razon_social)}`);
  lines.push(`- CUIT: ${m.cuit}`); // cuit ya normalizado por schema, no requiere sanitize
  lines.push(`- Domicilio: ${sanitizeField(m.domicilio)}`);
  lines.push(`- Localidad: ${sanitizeField(m.localidad)}`);
  lines.push(`- Provincia: ${provincia}`);
  lines.push('');

  // Actividad
  lines.push('**Actividad:**');
  lines.push(`- Actividad principal: ${sanitizeField(m.actividad_principal)}`);
  if (m.codigo_ciiu) {
    lines.push(`- CIIU: ${m.codigo_ciiu}`); // ciiu es digitos puros
  }
  lines.push('');

  // Operacion
  lines.push('**Operación:**');
  lines.push(`- Cantidad de empleados: ${m.cantidad_empleados}`);
  lines.push(`- Distribución de turnos: ${turno}`);
  lines.push(`- Modalidad operativa: ${modalidad}`);
  lines.push('');

  // Cobertura y servicio
  lines.push('**Cobertura y servicio:**');
  lines.push(`- ART contratada: ${sanitizeField(m.art_contratada)}`);
  lines.push(`- Servicio HyS: ${servicio}`);
  lines.push('');

  // Relevamiento
  lines.push('**Relevamiento:**');
  lines.push(`- Fecha: ${m.fecha_relevamiento}`);
  lines.push(`- Áreas relevadas (${m.areas_relevadas.length}):`);
  for (const area of m.areas_relevadas) {
    lines.push(`  - ${sanitizeField(area)}`);
  }
  lines.push('');

  // Riesgos pre-detectados (opcional, omitido si ausente)
  if (m.riesgos_pre_detectados) {
    lines.push('**Riesgos pre-detectados (entrada del consultor):**');
    lines.push(renderAsBlockquote(sanitizeField(m.riesgos_pre_detectados)));
    lines.push('');
  }

  // Footer de re-anclaje: re-instruye al modelo a su rol original.
  lines.push('---');
  lines.push('');
  lines.push(
    'Generá el RGRL siguiendo la estructura de 10 secciones definida en tus instrucciones. Usá los datos de arriba en lugar de placeholders "[A COMPLETAR]". Mantené placeholders solo para los campos que NO te di (número de contrato ART, fecha de alta ART, responsable matriculado, médico del trabajo).',
  );

  return lines.join('\n');
}
