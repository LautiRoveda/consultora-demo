import type { AccidenteMetadata } from './schema';

import {
  renderCamposPersonalizadosBlock,
  renderInstruccionesAdicionalesBlock,
} from '../common/render-extra';
import { renderAsBlockquote, sanitizeField } from '../common/sanitize';
import { gravedadLabel, parteCuerpoLabel, tipoLesionLabel } from './schema';

/**
 * T-022 · Render del metadata Accidente como bloque markdown estructurado
 * para inyectar al `user message` del Claude API call.
 *
 * Footer reaclara enfaticamente: NO inventar causa raiz ni nombres de
 * testigos. Proponer matriz de investigacion (5 porques, Ishikawa) a
 * completar por el equipo. Defensa critica vs alucinacion en un informe que
 * puede ser usado en denuncia ART o investigacion judicial.
 */
export function renderAccidenteMetadataAsPromptContext(metadata: AccidenteMetadata): string {
  const m = metadata;

  const lines: string[] = [];

  lines.push('## Datos del accidente (proporcionados por el consultor)');
  lines.push('');

  // Cliente
  lines.push('**Cliente:**');
  lines.push(`- Razón social: ${sanitizeField(m.razon_social)}`);
  lines.push(`- CUIT: ${m.cuit}`);
  lines.push(`- Domicilio: ${sanitizeField(m.domicilio)}`);
  lines.push('');

  // Suceso
  lines.push('**Suceso:**');
  lines.push(`- Fecha: ${m.fecha_accidente}`);
  lines.push(`- Hora: ${m.hora_accidente}`);
  lines.push(`- Lugar específico: ${sanitizeField(m.lugar_especifico)}`);
  lines.push(`- Puesto afectado: ${sanitizeField(m.puesto_afectado)}`);
  lines.push('');

  // Lesion
  lines.push('**Lesión:**');
  lines.push(`- Tipo(s) de lesión (${m.tipo_lesion.length}):`);
  for (const t of m.tipo_lesion) {
    lines.push(`  - ${tipoLesionLabel(t)}`);
  }
  lines.push(`- Parte(s) del cuerpo afectada(s) (${m.partes_cuerpo_afectadas.length}):`);
  for (const p of m.partes_cuerpo_afectadas) {
    lines.push(`  - ${parteCuerpoLabel(p)}`);
  }
  lines.push(`- Gravedad: ${gravedadLabel(m.gravedad)}`);
  if (typeof m.dias_baja_estimados === 'number') {
    lines.push(`- Días de baja estimados: ${m.dias_baja_estimados}`);
  }
  lines.push(`- Testigos presentes: ${m.testigos_presentes ? 'Sí' : 'No'}`);
  lines.push('');

  // Descripcion inicial (obligatoria — schema min 10)
  lines.push('**Descripción inicial (entrada del consultor):**');
  lines.push(renderAsBlockquote(sanitizeField(m.descripcion_inicial)));
  lines.push('');

  // T-138 · Personalizacion (campos → instrucciones), siempre ANTES del
  // footer de re-anclaje: la ultima palabra la tiene el sistema.
  lines.push(...renderCamposPersonalizadosBlock(m.campos_personalizados));
  lines.push(...renderInstruccionesAdicionalesBlock(m.instrucciones_adicionales));

  // Footer de re-anclaje — defensa anti-alucinacion critica para este tipo.
  lines.push('---');
  lines.push('');
  lines.push(
    'Generá el informe de accidente siguiendo la estructura de tus instrucciones. NO inventes causa raíz ni nombres de testigos: estructurá los datos provistos y proponé una matriz de investigación (5 porqués o Ishikawa) con campos a completar por el equipo investigador. Mantené placeholders para datos que NO te di (identificación nominal de testigos, croquis del sitio, mediciones post-accidente, declaración del afectado, firma de denuncia ART, número de siniestro). El consultor matriculado revisa y firma como responsable.',
  );

  return lines.join('\n');
}
