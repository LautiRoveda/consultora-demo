import type { RgrlMetadata } from './schema';

import {
  distribucionTurnoLabel,
  modalidadOperativaLabel,
  provinciaName,
  servicioHysModalidadLabel,
} from './schema';

/**
 * T-021 · Render del metadata RGRL como bloque markdown estructurado para
 * inyectar en el `user message` del Claude API call.
 *
 * Diseño:
 * - El bloque se prepende al userMessage. El `system` prompt no cambia →
 *   los hits de prompt caching (cache_control: ephemeral) se preservan.
 * - Los valores del consultor se escapan ANTES de concatenarse al template
 *   fijo. Estrategia defensiva contra prompt-injection (un member legitimo
 *   podria meter en `razon_social` algo como ```ignore previous```).
 * - Footer de re-anclaje: el ultimo parrafo re-instruye al modelo a su rol
 *   original. Tecnica clasica de defensa contra jailbreaks por inyeccion.
 * - Campos opcionales ausentes: NO se renderizan (no aparecen como
 *   "CIIU: null"). Si toda una seccion queda vacia (riesgos_pre_detectados),
 *   se omite la subseccion entera.
 *
 * Este modulo es server-only en uso (lo invoca el action al armar el prompt),
 * pero NO marca 'use server' — se importa tambien desde tests integration
 * para snapshot del shape.
 */

/**
 * Sanitiza un string user-controlled antes de meterlo en el markdown del
 * prompt:
 * - Triple backticks → '''.
 * - Backticks simples → '.
 * - "\n#" (heading injector tras newline) → "\n - #".
 * Length caps ya estan aplicados por Zod en `rgrlMetadataSchema`.
 */
function sanitizeField(s: string): string {
  return s.replace(/```/g, "'''").replace(/`/g, "'").replace(/\n#/g, '\n - #');
}

/**
 * Renderiza riesgos_pre_detectados como blockquote por linea. Cada linea
 * tipea `> ...` — limita la capacidad del campo de inyectar estructura
 * markdown libre (headings, listas anidadas, codeblocks).
 */
function renderRiesgosAsBlockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line.trim()}`)
    .filter((line) => line !== '> ')
    .join('\n');
}

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
    lines.push(renderRiesgosAsBlockquote(sanitizeField(m.riesgos_pre_detectados)));
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
