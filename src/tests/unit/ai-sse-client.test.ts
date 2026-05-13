/**
 * T-025 · Unit tests del parser SSE `parseSseStream` (sin Supabase ni
 * Anthropic — pure logic test).
 *
 * Cubre los edge cases del wire format:
 *  - Eventos bien formados (single + multiples en una sola chunk).
 *  - Fragmentacion del stream: evento partido en boundary, partido mid-evento.
 *  - Multi-line data (data: foo \n data: bar \n\n → "foo\nbar").
 *  - Lineas comment (`:heartbeat`) ignoradas.
 *  - Campos desconocidos (`id:`, `retry:`) ignorados.
 *  - CRLF en line endings.
 *  - Bloque sin terminator `\n\n` al cierre (discarded).
 *  - Bloque vacio (sin `event:`) descartado.
 *  - Espacio inicial despues del `:` strippeado.
 *
 * Correr local: `pnpm test`.
 */
import type { ServerSentEvent } from '@/shared/ai/sse-client';
import { describe, expect, it } from 'vitest';

import { parseSseStream } from '@/shared/ai/sse-client';

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ServerSentEvent[]> {
  const out: ServerSentEvent[] = [];
  for await (const ev of parseSseStream(stream)) out.push(ev);
  return out;
}

describe('parseSseStream', () => {
  it('1. single well-formed event', async () => {
    const events = await collect(makeStream(['event: delta\ndata: {"text":"hola"}\n\n']));
    expect(events).toEqual([{ type: 'delta', data: '{"text":"hola"}' }]);
  });

  it('2. multiple events en una sola chunk', async () => {
    const events = await collect(
      makeStream(['event: delta\ndata: A\n\nevent: delta\ndata: B\n\nevent: done\ndata: {}\n\n']),
    );
    expect(events).toEqual([
      { type: 'delta', data: 'A' },
      { type: 'delta', data: 'B' },
      { type: 'done', data: '{}' },
    ]);
  });

  it('3. evento partido en el boundary \\n\\n entre chunks', async () => {
    const events = await collect(
      makeStream(['event: delta\ndata: A\n\nevent: delta\ndata: B', '\n\n']),
    );
    expect(events).toEqual([
      { type: 'delta', data: 'A' },
      { type: 'delta', data: 'B' },
    ]);
  });

  it('4. evento partido a mitad de linea entre chunks', async () => {
    const events = await collect(makeStream(['event: del', 'ta\ndata: {"te', 'xt":"hola"}\n\n']));
    expect(events).toEqual([{ type: 'delta', data: '{"text":"hola"}' }]);
  });

  it('5. multi-line data se concatena con \\n', async () => {
    const events = await collect(makeStream(['event: chunk\ndata: linea1\ndata: linea2\n\n']));
    expect(events).toEqual([{ type: 'chunk', data: 'linea1\nlinea2' }]);
  });

  it('6. comment lines (`:heartbeat`) se ignoran', async () => {
    const events = await collect(
      makeStream([':heartbeat\n\nevent: delta\ndata: A\n\n:keepalive\n\n']),
    );
    expect(events).toEqual([{ type: 'delta', data: 'A' }]);
  });

  it('7. campos desconocidos (id, retry) se ignoran', async () => {
    const events = await collect(makeStream(['id: 42\nretry: 1000\nevent: delta\ndata: A\n\n']));
    expect(events).toEqual([{ type: 'delta', data: 'A' }]);
  });

  it('8. CRLF (\\r\\n) en line endings', async () => {
    const events = await collect(
      makeStream(['event: delta\r\ndata: A\r\n\r\nevent: done\r\ndata: {}\r\n\r\n']),
    );
    // Nota: nuestro split actual es por \n\n, asi que \r\n\r\n cuenta como
    // \r\n + \r\n donde el primer \r\n separa lineas y el segundo \r es parte
    // de la linea siguiente. La normalizacion del CR final en parseEventBlock
    // lo strippea.
    expect(events).toEqual([
      { type: 'delta', data: 'A' },
      { type: 'done', data: '{}' },
    ]);
  });

  it('9. bloque sin terminator \\n\\n al cierre del stream se descarta', async () => {
    const events = await collect(makeStream(['event: delta\ndata: A\n\nevent: delta\ndata: B']));
    expect(events).toEqual([{ type: 'delta', data: 'A' }]);
  });

  it('10. bloque sin `event:` (solo data) se descarta', async () => {
    const events = await collect(makeStream(['data: huerfano\n\nevent: delta\ndata: ok\n\n']));
    expect(events).toEqual([{ type: 'delta', data: 'ok' }]);
  });

  it('11. espacio inicial despues del `:` se strippea', async () => {
    const events = await collect(makeStream(['event:delta\ndata:{"x":1}\n\n']));
    expect(events).toEqual([{ type: 'delta', data: '{"x":1}' }]);

    const events2 = await collect(makeStream(['event: delta\ndata: {"x":1}\n\n']));
    expect(events2).toEqual([{ type: 'delta', data: '{"x":1}' }]);
  });

  it('12. caracteres unicode multi-byte fragmentados entre chunks', async () => {
    const encoder = new TextEncoder();
    // El char "ñ" en UTF-8 ocupa 2 bytes: 0xC3 0xB1. Lo partimos en el medio
    // entre dos chunks para verificar que TextDecoder({stream:true}) los
    // recombina sin corrupcion.
    const nBytes = encoder.encode('event: delta\ndata: ma');
    const chunk1 = new Uint8Array([...nBytes, 0xc3]); // primer byte de ñ
    const chunk2 = new Uint8Array([0xb1, ...encoder.encode('ana\n\n')]); // segundo byte + cont.

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    const events: ServerSentEvent[] = [];
    for await (const ev of parseSseStream(stream)) events.push(ev);
    expect(events).toEqual([{ type: 'delta', data: 'mañana' }]);
  });
});
