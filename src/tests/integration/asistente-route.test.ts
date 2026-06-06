/**
 * T-117 / T-117-FU3 · Tests integration del route POST /api/asistente (streaming SSE).
 *
 * El cliente Anthropic está MOCKEADO (vi.mock('@/shared/ai/anthropic')) — pero
 * ahora se mockea `messages.stream()` (no `create`): devolvemos un objeto que es
 * async-iterable de raw events Y tiene `.finalMessage()`, igual al MessageStream
 * del SDK. El dispatcher corre queries reales contra la DB sembrada.
 *
 * Cubre el contrato SSE (T-117-FU3):
 *  1. loop tool_use → tool_result → end_turn: emite `tool` + `delta` + stop/usage/done,
 *     tokens sumados cross-turno, el 2º request lleva assistant tool_use + user tool_result.
 *  2. cap de iteraciones → delta(fallback) + stop.reason 'iteration_cap_reached'.
 *  3. is_error en tool_result → el loop sigue y responde igual.
 *  4. error del SDK post-200 → evento SSE `error` (no HTTP 500).
 *  5. abort mid-stream → evento `error` STREAM_ABORTED, sin `done`.
 *  6. guard: signal ya abortado → STREAM_ABORTED, la IA NO se invoca (red→green).
 *  7. gates HTTP pre-stream: 400 / 401 / 403 / 402, la IA NO se invoca.
 *
 * Nota: con `disable_parallel_tool_use:true` el runtime nunca emite 2 tool_use en un
 * turno, así que NO testeamos ese escenario (imposible en prod).
 */
import type { ServerSentEvent } from '@/shared/ai/sse-client';
import type { Database } from '@/shared/supabase/types';
import Anthropic from '@anthropic-ai/sdk';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseSseStream } from '@/shared/ai/sse-client';

import { createTestConsultora } from './helpers/consultora';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
  cookies: () =>
    Promise.resolve({
      getAll: () => cookieStore.map((c) => ({ name: c.name, value: c.value })),
      set: (name: string, value: string) => {
        const idx = cookieStore.findIndex((c) => c.name === name);
        if (idx >= 0) cookieStore[idx] = { name, value };
        else cookieStore.push({ name, value });
      },
    }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  },
}));

const mockMessagesStream = vi.fn();
vi.mock('@/shared/ai/anthropic', () => ({
  CLAUDE_MODEL: 'claude-sonnet-4-6',
  CLAUDE_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
  getAnthropicClient: () => ({
    messages: { create: vi.fn(), stream: mockMessagesStream },
  }),
}));

/**
 * Construye un mock de `messages.stream()`: async-iterable de raw events +
 * `.finalMessage()`. `kind:'tool'` emite content_block_start tool_use (sin texto);
 * `kind:'text'` emite text_delta por chunk. El orquestador lee el `input` de la
 * tool desde `.finalMessage()`, así que el iterador no necesita input_json_delta.
 */
type ToolBlock = { id: string; name: string; input: unknown };
type TurnSpec =
  | { kind: 'tool'; tools: ToolBlock[]; inputTokens?: number; outputTokens?: number }
  | {
      kind: 'text';
      chunks: string[];
      stopReason?: 'end_turn' | 'max_tokens' | 'refusal';
      inputTokens?: number;
      outputTokens?: number;
      pauseEachMs?: number;
    };

function makeChatStreamMock(turn: TurnSpec) {
  const model = 'claude-haiku-4-5-20251001';
  const inputTokens = turn.inputTokens ?? 100;
  const outputTokens = turn.outputTokens ?? 20;

  const content =
    turn.kind === 'tool'
      ? turn.tools.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input }))
      : [{ type: 'text', text: turn.chunks.join('') }];
  const stopReason = turn.kind === 'tool' ? 'tool_use' : (turn.stopReason ?? 'end_turn');

  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'message_start',
        message: { id: 'msg_test', model, usage: { input_tokens: inputTokens, output_tokens: 0 } },
      } as const;
      if (turn.kind === 'tool') {
        let index = 0;
        for (const t of turn.tools) {
          yield {
            type: 'content_block_start',
            index,
            content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} },
          } as const;
          yield { type: 'content_block_stop', index } as const;
          index += 1;
        }
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: outputTokens },
        } as const;
      } else {
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        } as const;
        for (const chunk of turn.chunks) {
          if (turn.pauseEachMs) await new Promise((r) => setTimeout(r, turn.pauseEachMs));
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: chunk },
          } as const;
        }
        yield { type: 'content_block_stop', index: 0 } as const;
        yield {
          type: 'message_delta',
          delta: { stop_reason: turn.stopReason ?? 'end_turn' },
          usage: { output_tokens: outputTokens },
        } as const;
      }
      yield { type: 'message_stop' } as const;
    },
    finalMessage: () =>
      Promise.resolve({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model,
        stop_reason: stopReason,
        stop_sequence: null,
        content,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      }),
  };
}

/** Mock que tira al iterar (error del SDK al abrir el stream). */
function makeThrowingStreamMock(err: Error) {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => Promise.reject(err),
        return: () => Promise.resolve({ done: true, value: undefined }),
      };
    },
    finalMessage: () => Promise.reject(err),
  };
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error('Tests requieren env Supabase. Correr con .env.local cargado.');
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';
const slugA = `t117s-a-${runId}`;
const slugGated = `t117s-gated-${runId}`;
const emailOwnerA = `t117s-a-${runId}@example.com`;
const emailGated = `t117s-gated-${runId}@example.com`;
const emailNoConsul = `t117s-noc-${runId}@example.com`;

let cAId: string;
let cGatedId: string;
let ownerAId: string;
let ownerGatedId: string;
let noConsulId: string;
let clienteAId: string;

function makeCuit(prefix: string, base: string, check: string): string {
  return `${prefix}-${base.padStart(8, '0')}-${check}`;
}

beforeAll(async () => {
  cAId = (await createTestConsultora(admin, { name: 'T117S-A', slug: slugA })).id;
  // Trial vencido → BILLING_GATED.
  cGatedId = (
    await createTestConsultora(admin, { name: 'T117S-Gated', slug: slugGated, trialHasta: null })
  ).id;

  ownerAId = (
    await admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true })
  ).data.user!.id;
  ownerGatedId = (
    await admin.auth.admin.createUser({ email: emailGated, password, email_confirm: true })
  ).data.user!.id;
  noConsulId = (
    await admin.auth.admin.createUser({ email: emailNoConsul, password, email_confirm: true })
  ).data.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerGatedId, consultora_id: cGatedId, role: 'owner' },
  ]);
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, {
      app_metadata: { consultora_id: cAId, consultora_role: 'owner' },
    }),
    admin.auth.admin.updateUserById(ownerGatedId, {
      app_metadata: { consultora_id: cGatedId, consultora_role: 'owner' },
    }),
  ]);

  const cuitBase = Date.now().toString().slice(-8);
  clienteAId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Cliente A ${runId}`,
        cuit: makeCuit('30', cuitBase, '1'),
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;

  await admin.from('empleados').insert({
    consultora_id: cAId,
    cliente_id: clienteAId,
    nombre: 'Pepe',
    apellido: 'Pereira',
    dni: '20444444',
    created_by: ownerAId,
  });
});

afterAll(async () => {
  await admin.from('empleados').delete().in('consultora_id', [cAId, cGatedId]);
  await admin.from('clientes').delete().in('consultora_id', [cAId, cGatedId]);
  await admin.from('consultora_members').delete().in('consultora_id', [cAId, cGatedId]);
  await admin.from('consultoras').delete().in('id', [cAId, cGatedId]);
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerGatedId).catch(() => {});
  await admin.auth.admin.deleteUser(noConsulId).catch(() => {});
});

beforeEach(() => {
  cookieStore.length = 0;
  mockMessagesStream.mockReset();
});

const sessionCache = new Map<string, Array<{ name: string; value: string }>>();
async function signInAs(email: string): Promise<void> {
  cookieStore.length = 0;
  const cached = sessionCache.get(email);
  if (cached) {
    for (const c of cached) cookieStore.push({ ...c });
    return;
  }
  const { createClient: createServerClient } = await import('@/shared/supabase/server');
  const sb = await createServerClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  sessionCache.set(
    email,
    cookieStore.map((c) => ({ ...c })),
  );
}

function makeReq(body: unknown, signal?: AbortSignal): NextRequest {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest('http://localhost:3000/api/asistente', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: bodyStr,
    signal,
  });
}

async function consumeStream(res: Response): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = [];
  if (!res.body) return events;
  for await (const ev of parseSseStream(res.body)) events.push(ev);
  return events;
}

function answerText(events: ServerSentEvent[]): string {
  return events
    .filter((e) => e.type === 'delta')
    .map((e) => (JSON.parse(e.data) as { text: string }).text)
    .join('');
}

describe('POST /api/asistente (streaming SSE)', () => {
  it('1. loop tool_use → end_turn: emite tool+delta+stop+usage+done, tokens sumados, tool_result con id', async () => {
    await signInAs(emailOwnerA);
    mockMessagesStream
      .mockReturnValueOnce(
        makeChatStreamMock({
          kind: 'tool',
          tools: [{ id: 'toolu_1', name: 'buscar_empleado', input: { query: 'Pereira' } }],
          inputTokens: 500,
          outputTokens: 40,
        }),
      )
      .mockReturnValueOnce(
        makeChatStreamMock({
          kind: 'text',
          chunks: ['A Pereira se le ', 'entregó un **casco**.'],
          inputTokens: 600,
          outputTokens: 50,
        }),
      );

    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(
      makeReq({ messages: [{ role: 'user', content: '¿Qué se le entregó a Pereira?' }] }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const events = await consumeStream(res);
    const types = events.map((e) => e.type);

    // Chip de la tool antes de los deltas del answer.
    const toolEv = events.find((e) => e.type === 'tool');
    expect(toolEv).toBeDefined();
    expect(JSON.parse(toolEv!.data)).toEqual({ name: 'buscar_empleado' });
    expect(types.indexOf('tool')).toBeLessThan(types.indexOf('delta'));

    // Deltas reconstruyen el answer final.
    expect(answerText(events)).toBe('A Pereira se le entregó un **casco**.');

    // Cierre ordenado.
    expect(types.filter((t) => t === 'stop' || t === 'usage' || t === 'done')).toEqual([
      'stop',
      'usage',
      'done',
    ]);
    const stopEv = events.find((e) => e.type === 'stop')!;
    expect(JSON.parse(stopEv.data)).toEqual({ reason: 'end_turn' });

    // Tokens acumulados cross-turno (500+600 / 40+50).
    const usage = JSON.parse(events.find((e) => e.type === 'usage')!.data) as {
      inputTokens: number;
      outputTokens: number;
    };
    expect(usage.inputTokens).toBe(1100);
    expect(usage.outputTokens).toBe(90);

    expect(mockMessagesStream).toHaveBeenCalledTimes(2);

    // El 2º request lleva el turno assistant (tool_use verbatim) + user (tool_result).
    const secondMessages = mockMessagesStream.mock.calls[1]![0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    const assistantTurn = secondMessages.find(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((b: { type: string }) => b.type === 'tool_use'),
    );
    expect(assistantTurn).toBeDefined();
    const toolResults = secondMessages.flatMap((m) =>
      Array.isArray(m.content)
        ? (m.content as Array<{ type: string; tool_use_id?: string }>).filter(
            (b) => b.type === 'tool_result',
          )
        : [],
    );
    expect(toolResults.map((b) => b.tool_use_id)).toEqual(['toolu_1']);
  });

  it('2. cap de iteraciones: tool_use infinito → delta(fallback) + stop iteration_cap_reached', async () => {
    await signInAs(emailOwnerA);
    mockMessagesStream.mockReturnValue(
      makeChatStreamMock({
        kind: 'tool',
        tools: [{ id: 'toolu_loop', name: 'buscar_empleado', input: { query: 'x' } }],
      }),
    );

    const { POST } = await import('@/app/api/asistente/route');
    const { EPP_CHAT_MAX_ITERATIONS, EPP_CHAT_FALLBACK_CAP } =
      await import('@/shared/ai/prompts/epp-chat');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'loopealo' }] }));
    expect(res.status).toBe(200);

    const events = await consumeStream(res);
    expect(answerText(events)).toBe(EPP_CHAT_FALLBACK_CAP);
    const stopEv = events.find((e) => e.type === 'stop')!;
    expect(JSON.parse(stopEv.data)).toEqual({ reason: 'iteration_cap_reached' });
    expect(events.at(-1)!.type).toBe('done');
    expect(mockMessagesStream).toHaveBeenCalledTimes(EPP_CHAT_MAX_ITERATIONS);
  });

  it('3. is_error en tool_result → el loop se recupera y responde', async () => {
    await signInAs(emailOwnerA);
    mockMessagesStream
      .mockReturnValueOnce(
        makeChatStreamMock({
          kind: 'tool',
          // empleado_id no-UUID → dispatchTool devuelve isError:true (no tira).
          tools: [
            { id: 'toolu_bad', name: 'epp_entregado_a_empleado', input: { empleado_id: 'nope' } },
          ],
        }),
      )
      .mockReturnValueOnce(makeChatStreamMock({ kind: 'text', chunks: ['No tengo ese dato.'] }));

    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'datos' }] }));
    expect(res.status).toBe(200);

    const events = await consumeStream(res);
    expect(answerText(events)).toBe('No tengo ese dato.');

    const secondMessages = mockMessagesStream.mock.calls[1]![0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    const toolResult = secondMessages
      .flatMap((m) =>
        Array.isArray(m.content)
          ? (m.content as Array<{ type: string; is_error?: boolean }>).filter(
              (b) => b.type === 'tool_result',
            )
          : [],
      )
      .at(0);
    expect(toolResult?.is_error).toBe(true);
  });

  it('4. error del SDK post-200 → evento SSE error (no HTTP 500)', async () => {
    await signInAs(emailOwnerA);
    mockMessagesStream.mockReturnValueOnce(
      makeThrowingStreamMock(new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers())),
    );

    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'x' }] }));
    expect(res.status).toBe(200); // El error llega DENTRO del stream.

    const events = await consumeStream(res);
    const errEv = events.find((e) => e.type === 'error');
    expect(errEv).toBeDefined();
    expect((JSON.parse(errEv!.data) as { code: string }).code).toBe('RATE_LIMITED');
    expect(events.find((e) => e.type === 'done')).toBeUndefined();
  });

  it('5. abort mid-stream → evento error STREAM_ABORTED, sin done', async () => {
    await signInAs(emailOwnerA);
    mockMessagesStream.mockReturnValueOnce(
      makeChatStreamMock({
        kind: 'text',
        chunks: Array.from({ length: 20 }, (_, i) => `chunk-${i} `),
        pauseEachMs: 10,
      }),
    );

    const ac = new AbortController();
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'x' }] }, ac.signal));
    expect(res.status).toBe(200);

    const events: ServerSentEvent[] = [];
    let aborted = false;
    for await (const ev of parseSseStream(res.body!)) {
      events.push(ev);
      if (ev.type === 'delta' && !aborted) {
        aborted = true;
        ac.abort();
      }
      if (ev.type === 'error' || ev.type === 'done') break;
    }

    expect(aborted).toBe(true);
    const errEv = events.find((e) => e.type === 'error');
    expect(errEv).toBeDefined();
    expect((JSON.parse(errEv!.data) as { code: string }).code).toBe('STREAM_ABORTED');
    expect(events.find((e) => e.type === 'done')).toBeUndefined();
  });

  it('6. guard: signal ya abortado → STREAM_ABORTED y la IA NO se invoca', async () => {
    await signInAs(emailOwnerA);
    mockMessagesStream.mockReturnValue(makeChatStreamMock({ kind: 'text', chunks: ['hola'] }));

    const ac = new AbortController();
    ac.abort(); // abortado ANTES de leer el stream
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'x' }] }, ac.signal));
    expect(res.status).toBe(200);

    const events = await consumeStream(res);
    const errEv = events.find((e) => e.type === 'error');
    expect((JSON.parse(errEv!.data) as { code: string }).code).toBe('STREAM_ABORTED');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('7a. body inválido (historial vacío) → 400, IA no invocada', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_INPUT');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('7b. último turno no es del usuario → 400, IA no invocada', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'assistant', content: 'hola' }] }));
    expect(res.status).toBe(400);
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('7c. sin cookie → 401, IA no invocada', async () => {
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'hola' }] }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHENTICATED');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('7d. user sin consultora → 403, IA no invocada', async () => {
    await signInAs(emailNoConsul);
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'hola' }] }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NO_CONSULTORA');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('7e. trial vencido → 402 BILLING_GATED, IA no invocada', async () => {
    await signInAs(emailGated);
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'hola' }] }));
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe('BILLING_GATED');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });
});
