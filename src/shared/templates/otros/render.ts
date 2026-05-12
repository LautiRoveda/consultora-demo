import type { OtrosMetadata } from './schema';

import { renderAsBlockquote, sanitizeField } from '../common/sanitize';

/**
 * T-022 · Render del metadata "Otros" como bloque markdown estructurado para
 * inyectar al `user message` del Claude API call.
 *
 * Estructura minima — el tipo es wildcard. Solo identificacion cliente +
 * tema + objetivos libres. Footer no impone estructura especifica al modelo:
 * el `tema_informe` + `objetivos` orientan la salida.
 */
export function renderOtrosMetadataAsPromptContext(metadata: OtrosMetadata): string {
  const m = metadata;

  const lines: string[] = [];

  lines.push('## Datos del informe (proporcionados por el consultor)');
  lines.push('');

  // Cliente (solo razon_social + cuit — `otros` no tiene domicilio por schema)
  lines.push('**Cliente:**');
  lines.push(`- Razón social: ${sanitizeField(m.razon_social)}`);
  lines.push(`- CUIT: ${m.cuit}`);
  lines.push('');

  // Solicitud
  lines.push('**Solicitud:**');
  lines.push(`- Tema: ${sanitizeField(m.tema_informe)}`);
  lines.push('');

  // Objetivos (opcional)
  if (m.objetivos) {
    lines.push('**Objetivos / contexto adicional (entrada del consultor):**');
    lines.push(renderAsBlockquote(sanitizeField(m.objetivos)));
    lines.push('');
  }

  // Footer de re-anclaje minimalista — no impone estructura, deja que el tema
  // y los objetivos del consultor guien la salida.
  lines.push('---');
  lines.push('');
  lines.push(
    'Generá el informe solicitado siguiendo la estructura de tus instrucciones, adaptada al tema y los objetivos provistos. Usá los datos de cliente arriba en lugar de placeholders "[A COMPLETAR]". Mantené placeholders para todo dato que NO te di explícitamente.',
  );

  return lines.join('\n');
}
