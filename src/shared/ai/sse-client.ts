/**
 * T-025 · Parser SSE minimal sobre un `ReadableStream<Uint8Array>`.
 *
 * Cubre solo lo que necesita nuestro contrato (route handler `generate-stream`):
 *  - Eventos delimitados por linea vacia (`\n\n`).
 *  - Lineas `event: <type>` y `data: <text>`. Multi-line `data:` (con \n entre
 *    campos data del mismo evento) lo soportamos por seguridad pero no lo
 *    emitimos.
 *  - Ignora comments (`:` lineas) y campos desconocidos.
 *
 * Isomorphic: usa `TextDecoder` + Web Streams nativos, funciona en navegador
 * y en Node (vitest unit tests). Sin dep externa — `eventsource-parser` solo
 * agregaria ~3KB para lo mismo.
 */

export type ServerSentEvent = { type: string; data: string };

/**
 * Spec SSE acepta tres separadores de eventos: \n\n, \r\n\r\n, \r\r.
 * El servidor de T-025 siempre emite \n\n pero el parser soporta los tres
 * por robustez con sources externos.
 */
const SSE_EVENT_BOUNDARY = /\r?\n\r?\n|\r\r/;

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush del decoder por si quedo un multi-byte char a medias.
        buffer += decoder.decode();
        // Si quedo un bloque no terminado (sin \n\n al final) lo descartamos.
        // El servidor SIEMPRE cierra con \n\n; un bloque parcial indica corte
        // de conexion y no queremos emitir un evento malformado.
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let match = SSE_EVENT_BOUNDARY.exec(buffer);
      while (match) {
        const raw = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const event = parseEventBlock(raw);
        if (event) yield event;
        match = SSE_EVENT_BOUNDARY.exec(buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEventBlock(raw: string): ServerSentEvent | null {
  let type = '';
  let data = '';
  for (const lineRaw of raw.split('\n')) {
    // Normaliza CR final si el server uso \r\n\r\n.
    const line = lineRaw.endsWith('\r') ? lineRaw.slice(0, -1) : lineRaw;
    if (line.startsWith(':') || line === '') continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx);
    // Spec SSE: un espacio inicial despues del `:` se descarta.
    const value = line[colonIdx + 1] === ' ' ? line.slice(colonIdx + 2) : line.slice(colonIdx + 1);
    if (field === 'event') type = value;
    else if (field === 'data') data = data ? data + '\n' + value : value;
  }
  if (!type) return null;
  return { type, data };
}
