import type { RelevamientoMetadata } from './schema';

import {
  renderCamposPersonalizadosBlock,
  renderInstruccionesAdicionalesBlock,
} from '../common/render-extra';
import { renderAsBlockquote, sanitizeField } from '../common/sanitize';
import { provinciaName } from '../common/site';
import { agenteHysLabel } from './schema';

/**
 * T-022 · Render del metadata Relevamiento como bloque markdown estructurado
 * para inyectar al `user message` del Claude API call.
 *
 * Footer enfatiza: el modelo sugiere umbrales SRT por agente (Decreto 351/79
 * Anexo V, Res. 295/03 ruido, etc.), no inventa mediciones cuantitativas.
 */
export function renderRelevamientoMetadataAsPromptContext(metadata: RelevamientoMetadata): string {
  const m = metadata;
  const provincia = `${provinciaName(m.provincia)} (${m.provincia})`;

  const lines: string[] = [];

  lines.push('## Datos del relevamiento técnico (proporcionados por el consultor)');
  lines.push('');

  // Cliente
  lines.push('**Cliente:**');
  lines.push(`- Razón social: ${sanitizeField(m.razon_social)}`);
  lines.push(`- CUIT: ${m.cuit}`);
  lines.push(`- Domicilio: ${sanitizeField(m.domicilio)}`);
  lines.push(`- Localidad: ${sanitizeField(m.localidad)}`);
  lines.push(`- Provincia: ${provincia}`);
  lines.push('');

  // Alcance
  lines.push('**Alcance:**');
  lines.push(`- Fecha: ${m.fecha_relevamiento}`);
  lines.push(`- Áreas relevadas (${m.areas_relevadas.length}):`);
  for (const area of m.areas_relevadas) {
    lines.push(`  - ${sanitizeField(area)}`);
  }
  lines.push(`- Agentes a relevar (${m.agentes_a_relevar.length}):`);
  for (const agente of m.agentes_a_relevar) {
    lines.push(`  - ${agenteHysLabel(agente)}`);
  }
  lines.push('');

  // Equipos de medicion (opcional)
  if (m.equipos_medicion) {
    lines.push('**Equipos de medición disponibles (entrada del consultor):**');
    lines.push(renderAsBlockquote(sanitizeField(m.equipos_medicion)));
    lines.push('');
  }

  // T-138 · Personalizacion (campos → instrucciones), siempre ANTES del
  // footer de re-anclaje: la ultima palabra la tiene el sistema.
  lines.push(...renderCamposPersonalizadosBlock(m.campos_personalizados));
  lines.push(...renderInstruccionesAdicionalesBlock(m.instrucciones_adicionales));

  // Footer de re-anclaje
  lines.push('---');
  lines.push('');
  lines.push(
    'Generá el informe de relevamiento técnico siguiendo la estructura de tus instrucciones. Para cada agente listado, sugerí el umbral SRT aplicable (Decreto 351/79 Anexo V, Res. 295/03 para ruido, Res. 295/03 para iluminación, WBGT para carga térmica, etc.) — el consultor matriculado validará. NO inventes valores cuantitativos: mantené placeholders para mediciones que NO te di (valores numéricos por punto, fecha de calibración del instrumento, condiciones ambientales en el momento del relevamiento).',
  );

  return lines.join('\n');
}
