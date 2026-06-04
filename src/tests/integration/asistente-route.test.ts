/**
 * T-117 · Tests integration del route POST /api/asistente (loop + gates).
 *
 * El cliente Anthropic está MOCKEADO (vi.mock('@/shared/ai/anthropic')) — el
 * dispatcher corre queries reales contra la DB sembrada. Cubre:
 *  1. loop tool_use → tool_result → end_turn (2 llamadas, tokens sumados, el 2º
 *     request lleva el turno assistant tool_use + user tool_result con id matcheado).
 *  2. cap de iteraciones (tool_use infinito → corta en MAX_ITERATIONS, capped:true).
 *  3. multi-bloque (2 tool_use en un turno → 2 tool_result en el siguiente).
 *  4. error del SDK → 500, sin filtrar stack.
 *  5. gates: 400 body inválido · 401 sin cookie · 403 sin consultora · 402 billing
 *     gated; la IA NO se invoca en ninguno.
 *
 * Mock Anthropic: mismo patrón que epp-sugerir-route.test.ts.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

const mockMessagesCreate = vi.fn();
vi.mock('@/shared/ai/anthropic', () => ({
  CLAUDE_MODEL: 'claude-sonnet-4-6',
  CLAUDE_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
  getAnthropicClient: () => ({
    messages: { create: mockMessagesCreate, stream: vi.fn() },
  }),
}));

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
const slugA = `t117r-a-${runId}`;
const slugGated = `t117r-gated-${runId}`;
const emailOwnerA = `t117r-a-${runId}@example.com`;
const emailGated = `t117r-gated-${runId}@example.com`;
const emailNoConsul = `t117r-noc-${runId}@example.com`;

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
  cAId = (await createTestConsultora(admin, { name: 'T117R-A', slug: slugA })).id;
  // Trial vencido → BILLING_GATED.
  cGatedId = (
    await createTestConsultora(admin, { name: 'T117R-Gated', slug: slugGated, trialHasta: null })
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
  mockMessagesCreate.mockReset();
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

function makeReq(body: unknown): NextRequest {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest('http://localhost:3000/api/asistente', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: bodyStr,
  });
}

function toolUseBlock(id: string, name: string, input: unknown) {
  return { type: 'tool_use', id, name, input };
}

function toolUseResponse(blocks: unknown[], usage = { input: 100, output: 20 }) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: blocks,
    usage: { input_tokens: usage.input, output_tokens: usage.output },
  };
}

function endTurnResponse(text: string, usage = { input: 100, output: 30 }) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [{ type: 'text', text }],
    usage: { input_tokens: usage.input, output_tokens: usage.output },
  };
}

describe('POST /api/asistente', () => {
  it('1. loop tool_use → end_turn: 2 llamadas, tokens sumados, tool_result con id matcheado', async () => {
    await signInAs(emailOwnerA);
    mockMessagesCreate
      .mockResolvedValueOnce(
        toolUseResponse([toolUseBlock('toolu_1', 'buscar_empleado', { query: 'Pereira' })], {
          input: 500,
          output: 40,
        }),
      )
      .mockResolvedValueOnce(
        endTurnResponse('A Pereira se le entregó un casco.', { input: 600, output: 50 }),
      );

    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(
      makeReq({ messages: [{ role: 'user', content: '¿Qué se le entregó a Pereira?' }] }),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      answer: string;
      capped: boolean;
      tokens_used: { input: number; output: number; cost_usd: number };
      model: string;
    };
    expect(body.answer).toBe('A Pereira se le entregó un casco.');
    expect(body.capped).toBe(false);
    expect(body.tokens_used.input).toBe(1100);
    expect(body.tokens_used.output).toBe(90);
    expect(body.tokens_used.cost_usd).toBeGreaterThan(0);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);

    // El 2º request lleva el turno assistant (tool_use verbatim) + user (tool_result).
    const secondMessages = mockMessagesCreate.mock.calls[1]![0].messages as Array<{
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

  it('2. cap de iteraciones: tool_use infinito → capped, corta en MAX_ITERATIONS', async () => {
    await signInAs(emailOwnerA);
    mockMessagesCreate.mockResolvedValue(
      toolUseResponse([toolUseBlock('toolu_loop', 'buscar_empleado', { query: 'x' })]),
    );

    const { POST } = await import('@/app/api/asistente/route');
    const { EPP_CHAT_MAX_ITERATIONS } = await import('@/shared/ai/prompts/epp-chat');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'loopealo' }] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { capped: boolean };
    expect(body.capped).toBe(true);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(EPP_CHAT_MAX_ITERATIONS);
  });

  it('3. multi-bloque: 2 tool_use en un turno → 2 tool_result en el siguiente', async () => {
    await signInAs(emailOwnerA);
    mockMessagesCreate
      .mockResolvedValueOnce(
        toolUseResponse([
          toolUseBlock('toolu_a', 'buscar_empleado', { query: 'Pereira' }),
          toolUseBlock('toolu_b', 'vencimientos_epp_proximos', {}),
        ]),
      )
      .mockResolvedValueOnce(endTurnResponse('Listo.'));

    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'dos cosas' }] }));
    expect(res.status).toBe(200);

    const secondMessages = mockMessagesCreate.mock.calls[1]![0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    const toolResultIds = secondMessages
      .flatMap((m) =>
        Array.isArray(m.content)
          ? (m.content as Array<{ type: string; tool_use_id?: string }>).filter(
              (b) => b.type === 'tool_result',
            )
          : [],
      )
      .map((b) => b.tool_use_id)
      .sort();
    expect(toolResultIds).toEqual(['toolu_a', 'toolu_b']);
  });

  it('4. error del SDK → 500 INTERNAL_ERROR', async () => {
    await signInAs(emailOwnerA);
    mockMessagesCreate.mockRejectedValueOnce(new Error('boom'));

    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'x' }] }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INTERNAL_ERROR');
  });

  it('5. body inválido (historial vacío) → 400, IA no invocada', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_INPUT');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('6. último turno no es del usuario → 400, IA no invocada', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'assistant', content: 'hola' }] }));
    expect(res.status).toBe(400);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('7. sin cookie → 401, IA no invocada', async () => {
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'hola' }] }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHENTICATED');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('8. user sin consultora → 403, IA no invocada', async () => {
    await signInAs(emailNoConsul);
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'hola' }] }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NO_CONSULTORA');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('9. trial vencido → 402 BILLING_GATED, IA no invocada', async () => {
    await signInAs(emailGated);
    const { POST } = await import('@/app/api/asistente/route');
    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'hola' }] }));
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe('BILLING_GATED');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});
