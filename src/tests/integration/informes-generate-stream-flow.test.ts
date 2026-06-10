/**
 * T-025 · Tests del route handler POST /api/informes/[id]/generate-stream —
 * flow del stream + errores del SDK + audit log + metadata injection.
 *
 * Cubre el comportamiento dinamico del endpoint:
 *  1. Happy path: stream emite delta+stop+usage+done en orden + audit_log
 *     row con action 'informe_content_generated'.
 *  2. RateLimitError del SDK → evento `error` con code RATE_LIMITED.
 *  3. stop_reason='refusal' → evento `error` con code CONTENT_FILTER.
 *  4. Metadata RGRL injectada al user message del SDK call.
 *  5. Abort mid-stream → evento `error` STREAM_ABORTED + sin audit_log row.
 *
 * Patron mock: el wrapper streamAnthropicMessage llama
 * getAnthropicClient().messages.stream(params, { signal }) que devolvemos
 * como un objeto async-iterable de RawMessageStreamEvent. Importamos
 * Anthropic para usar las clases de error reales en throws (mismo patron
 * que informes-content-actions.test.ts).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { ServerSentEvent } from '@/shared/ai/sse-client';
import type { Database, Json } from '@/shared/supabase/types';
import type { RgrlMetadata } from '@/shared/templates/rgrl/schema';
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
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

const mockMessagesStream = vi.fn();
vi.mock('@/shared/ai/anthropic', () => ({
  CLAUDE_MODEL: 'claude-sonnet-4-6',
  getAnthropicClient: () => ({
    messages: { stream: mockMessagesStream },
  }),
}));

/**
 * Construye un objeto AsyncIterable<RawMessageStreamEvent> a partir de
 * chunks de texto. Si `throwError` se provee, tira despues de yieldear los
 * eventos previos al throw. Si `pauseEachMs > 0`, intercala setTimeout entre
 * events (necesario para tests de abort — sin el delay, todo el stream se
 * itera en una sola tick y el abort no tiene chance de propagarse).
 */
function makeStreamMock(args: {
  chunks: string[];
  stopReason?: 'end_turn' | 'max_tokens' | 'refusal';
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  throwAtStart?: Error;
  pauseEachMs?: number;
}) {
  const {
    chunks,
    stopReason = 'end_turn',
    inputTokens = 100,
    outputTokens = chunks.join('').length,
    cacheReadInputTokens = 0,
    throwAtStart,
    pauseEachMs = 0,
  } = args;

  return {
    async *[Symbol.asyncIterator]() {
      if (throwAtStart) throw throwAtStart;
      yield {
        type: 'message_start',
        message: {
          id: 'msg_test',
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: inputTokens,
            output_tokens: 0,
            cache_read_input_tokens: cacheReadInputTokens,
            cache_creation_input_tokens: 0,
          },
        },
      } as const;
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      } as const;
      for (const text of chunks) {
        if (pauseEachMs > 0) {
          await new Promise((r) => setTimeout(r, pauseEachMs));
        }
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text },
        } as const;
      }
      yield { type: 'content_block_stop', index: 0 } as const;
      yield {
        type: 'message_delta',
        delta: { stop_reason: stopReason },
        usage: { output_tokens: outputTokens },
      } as const;
      yield { type: 'message_stop' } as const;
    },
  };
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';

const slugA = `t025f-ca-${runId}`;
const emailOwnerA = `t025f-owner-a-${runId}@example.com`;

let cAId: string;
let ownerAId: string;
let informeRgrlNoMetadataId: string;
let informeRgrlWithMetadataId: string;

const rgrlFixture: RgrlMetadata = {
  razon_social: 'Talleres T025F SA',
  cuit: '30-99999999-9',
  domicilio: 'Av. Test 100',
  localidad: 'Tigre',
  provincia: 'BA',
  actividad_principal: 'Fabricación de prueba',
  cantidad_empleados: 50,
  distribucion_turno: 'continuo',
  modalidad_operativa: 'industrial',
  art_contratada: 'Test ART',
  servicio_hys_modalidad: 'externo',
  areas_relevadas: ['Producción / planta', 'Oficinas administrativas'],
  fecha_relevamiento: '2026-05-12',
};

beforeAll(async () => {
  const cA = await createTestConsultora(admin, { name: 'T025F cA', slug: slugA });
  cAId = cA.id;

  const { data: uOA } = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  ownerAId = uOA.user!.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: ownerAId, consultora_id: cAId, role: 'owner' });
  await admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } });

  // Informe RGRL sin metadata.
  const { data: i1 } = await admin
    .from('informes')
    .insert({
      consultora_id: cAId,
      tipo: 'rgrl',
      titulo: 'T025F flow: sin metadata',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  informeRgrlNoMetadataId = i1!.id;

  // Informe RGRL con metadata para el test de inyeccion.
  const { data: i2 } = await admin
    .from('informes')
    .insert({
      consultora_id: cAId,
      tipo: 'rgrl',
      titulo: 'T025F flow: con metadata',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  informeRgrlWithMetadataId = i2!.id;
  await admin
    .from('informe_metadata')
    .insert({ informe_id: informeRgrlWithMetadataId, data: rgrlFixture as Json });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
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

function makeReq(id: string, body: unknown, signal?: AbortSignal): NextRequest {
  return new NextRequest(`http://localhost:3000/api/informes/${id}/generate-stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(body),
    signal,
  });
}

async function consumeStream(res: Response): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = [];
  if (!res.body) return events;
  for await (const ev of parseSseStream(res.body)) events.push(ev);
  return events;
}

describe('POST /api/informes/[id]/generate-stream — flow', () => {
  it('1. happy path: stream emite delta+stop+usage+done en orden + audit_log row', async () => {
    await signInAs(emailOwnerA);
    mockMessagesStream.mockReturnValueOnce(
      makeStreamMock({
        chunks: ['# Informe RGRL\n\n', '## Datos\n\n', 'Contenido generado.'],
        inputTokens: 1500,
        outputTokens: 800,
        cacheReadInputTokens: 1200,
      }),
    );

    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeRgrlNoMetadataId, { userPrompt: 'Notas' }), {
      params: Promise.resolve({ id: informeRgrlNoMetadataId }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const events = await consumeStream(res);

    // Orden esperado: 3 deltas + stop + usage + done.
    const types = events.map((e) => e.type);
    expect(types).toEqual(['delta', 'delta', 'delta', 'stop', 'usage', 'done']);

    // Concat de los deltas reconstruye el contenido completo.
    const fullText = events
      .filter((e) => e.type === 'delta')
      .map((e) => (JSON.parse(e.data) as { text: string }).text)
      .join('');
    expect(fullText).toBe('# Informe RGRL\n\n## Datos\n\nContenido generado.');

    // Usage matchea lo mockeado.
    const usageEv = events.find((e) => e.type === 'usage')!;
    const usage = JSON.parse(usageEv.data) as {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
    };
    expect(usage.inputTokens).toBe(1500);
    expect(usage.outputTokens).toBe(800);
    expect(usage.cacheReadInputTokens).toBe(1200);

    const stopEv = events.find((e) => e.type === 'stop')!;
    expect(JSON.parse(stopEv.data)).toEqual({ reason: 'end_turn' });

    // SDK call con prompt caching ephemeral preservado.
    expect(mockMessagesStream).toHaveBeenCalledOnce();
    const call = mockMessagesStream.mock.calls[0]![0];
    expect(call.model).toBe('claude-sonnet-4-6');
    expect(call.max_tokens).toBe(8192);
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });

    // Audit log polling — el write es async (`void writeAuditLog`).
    let auditRow: Record<string, unknown> | null = null;
    for (let i = 0; i < 20; i++) {
      const { data } = await admin
        .from('audit_log')
        .select('action, entity_type, entity_id, actor_user_id, after_data')
        .eq('action', 'informe_content_generated')
        .eq('entity_id', informeRgrlNoMetadataId)
        .maybeSingle();
      if (data) {
        auditRow = data;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(auditRow).not.toBeNull();
    const afterData = auditRow!.after_data as Record<string, unknown>;
    expect(afterData.tipo).toBe('rgrl');
    expect(afterData.stop_reason).toBe('end_turn');
    expect(afterData.input_tokens).toBe(1500);
    expect(afterData.output_tokens).toBe(800);
    expect(afterData.stream).toBe(true);
  });

  it('2. RateLimitError del SDK → evento `error` code RATE_LIMITED', async () => {
    await signInAs(emailOwnerA);
    mockMessagesStream.mockReturnValueOnce(
      makeStreamMock({
        chunks: [],
        throwAtStart: new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers()),
      }),
    );

    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeRgrlNoMetadataId, { userPrompt: '' }), {
      params: Promise.resolve({ id: informeRgrlNoMetadataId }),
    });

    expect(res.status).toBe(200); // El error llega INSIDE el stream, no como HTTP error.
    const events = await consumeStream(res);
    const errorEv = events.find((e) => e.type === 'error');
    expect(errorEv).toBeDefined();
    const err = JSON.parse(errorEv!.data) as { code: string };
    expect(err.code).toBe('RATE_LIMITED');
  });

  it("3. stop_reason='refusal' → evento `error` code CONTENT_FILTER", async () => {
    await signInAs(emailOwnerA);
    mockMessagesStream.mockReturnValueOnce(
      makeStreamMock({
        chunks: [],
        stopReason: 'refusal',
      }),
    );

    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeRgrlNoMetadataId, { userPrompt: '' }), {
      params: Promise.resolve({ id: informeRgrlNoMetadataId }),
    });

    expect(res.status).toBe(200);
    const events = await consumeStream(res);
    const errorEv = events.find((e) => e.type === 'error');
    expect(errorEv).toBeDefined();
    const err = JSON.parse(errorEv!.data) as { code: string };
    expect(err.code).toBe('CONTENT_FILTER');
    // No emite done despues del error.
    expect(events.find((e) => e.type === 'done')).toBeUndefined();
  });

  it('4. metadata RGRL se inyecta al user message del SDK call', async () => {
    await signInAs(emailOwnerA);
    mockMessagesStream.mockReturnValueOnce(makeStreamMock({ chunks: ['# RGRL stub\n'] }));

    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeRgrlWithMetadataId, { userPrompt: 'Notas extra.' }), {
      params: Promise.resolve({ id: informeRgrlWithMetadataId }),
    });
    expect(res.status).toBe(200);
    // Drainamos para que el handler termine cleanly.
    await consumeStream(res);

    const call = mockMessagesStream.mock.calls[0]![0];
    const userMsg: string = call.messages[0].content;
    expect(userMsg).toContain('## Datos del establecimiento');
    expect(userMsg).toContain('Talleres T025F SA');
    expect(userMsg).toContain('CUIT: 30-99999999-9');
    // Notas adicionales se preservan despues del context.
    expect(userMsg).toContain('## Notas adicionales del consultor');
    expect(userMsg).toContain('Notas extra.');
    // Orden: context antes que notas.
    expect(userMsg.indexOf('Datos del establecimiento')).toBeLessThan(
      userMsg.indexOf('Notas adicionales'),
    );
  });

  it('5. abort mid-stream → evento `error` STREAM_ABORTED + NO audit_log row', async () => {
    await signInAs(emailOwnerA);

    // Informe fresco creado inline para que el assert "0 rows en audit_log"
    // sea univoco (los otros tests dejaron rows con entity_id distinto).
    const { data: freshInforme } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'otros',
        titulo: 'T025F abort isolation',
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const abortInformeId = freshInforme!.id;

    // Mock con pauseEachMs > 0 para que el abort tenga tiempo de propagarse
    // entre chunks. Sin esto, toda la iteracion del wrapper ocurre en
    // microtasks y el abort llega tarde.
    mockMessagesStream.mockReturnValueOnce(
      makeStreamMock({
        chunks: Array.from({ length: 20 }, (_, i) => `chunk-${i}\n`),
        pauseEachMs: 10,
      }),
    );

    const ac = new AbortController();
    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(abortInformeId, { userPrompt: '' }, ac.signal), {
      params: Promise.resolve({ id: abortInformeId }),
    });
    expect(res.status).toBe(200);

    // Lee al menos 1 delta antes de abortar.
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
    const errorEv = events.find((e) => e.type === 'error');
    expect(errorEv).toBeDefined();
    expect(JSON.parse(errorEv!.data).code).toBe('STREAM_ABORTED');
    // Si llego un `done` significa que la generacion completo antes del abort
    // — el test no probo lo que pretende. Falla con mensaje claro.
    expect(events.find((e) => e.type === 'done')).toBeUndefined();

    // Esperamos un poco para que (de haber sido insertado) el audit row
    // aparezca, y verificamos que SIGUE en 0 para este informe.
    await new Promise((r) => setTimeout(r, 600));
    const { count } = await admin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'informe_content_generated')
      .eq('entity_id', abortInformeId);
    expect(count).toBe(0);
  });

  it('6. T-138: personalizacion en user message; system[0] estatico aun con bloque SRT en system[1]', async () => {
    await signInAs(emailOwnerA);

    // Relevamiento con agente 'ruido' (dispara la inyeccion SRT T-107 como
    // system[1]) + personalizacion T-138. La combinacion prueba que ninguno
    // de los dos mecanismos toca el prompt estatico del tipo (system[0]).
    const { data: freshInforme } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'relevamiento',
        titulo: 'T138 stream personalizacion',
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const relevamientoId = freshInforme!.id;
    await admin.from('informe_metadata').insert({
      informe_id: relevamientoId,
      data: {
        razon_social: 'Talleres T138 SA',
        cuit: '30-88888888-8',
        domicilio: 'Av. Test 200',
        localidad: 'Tigre',
        provincia: 'BA',
        fecha_relevamiento: '2026-06-01',
        areas_relevadas: ['Producción / planta'],
        agentes_a_relevar: ['ruido'],
        campos_personalizados: [{ label: 'Norma interna', valor: 'IRAM 3800' }],
        instrucciones_adicionales: 'priorizá recomendaciones de bajo costo',
        // Fase 2: estructura no-default (subset reordenado + custom).
        secciones: [
          { kind: 'catalogo', seccion_id: 'mediciones' },
          { kind: 'custom', titulo: 'Plan de izaje', descripcion: 'Secuencia y señalero' },
          { kind: 'catalogo', seccion_id: 'recomendaciones' },
        ],
      } as Json,
    });

    mockMessagesStream.mockReturnValueOnce(makeStreamMock({ chunks: ['# Informe stub\n'] }));

    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(relevamientoId, { userPrompt: '' }), {
      params: Promise.resolve({ id: relevamientoId }),
    });
    expect(res.status).toBe(200);
    await consumeStream(res);

    const call = mockMessagesStream.mock.calls[0]![0];
    const userMsg: string = call.messages[0].content;

    // Bloques de personalizacion presentes y ANTES del footer de re-anclaje.
    expect(userMsg).toContain('**Campos personalizados (definidos por el consultor):**');
    expect(userMsg).toContain('- Norma interna: IRAM 3800');
    expect(userMsg).toContain('> priorizá recomendaciones de bajo costo');
    expect(userMsg.indexOf('Generá el informe de relevamiento técnico')).toBeGreaterThan(
      userMsg.indexOf('> priorizá recomendaciones de bajo costo'),
    );

    // Fase 2: bloque "Estructura solicitada" con labels + custom, en orden.
    expect(userMsg).toContain(
      '**Estructura solicitada (el informe debe contener SOLO estas secciones, en este orden):**',
    );
    expect(userMsg).toContain('1. Mediciones realizadas');
    expect(userMsg).toContain('2. [Sección personalizada] Plan de izaje — Secuencia y señalero');
    expect(userMsg).toContain('3. Recomendaciones');

    // system[0] EXACTAMENTE el prompt estatico del tipo: compliance intacto y
    // cache preservado (T-138 no agrega nada al system por-request).
    const { SYSTEM_PROMPT_RELEVAMIENTO } = await import('@/shared/ai/prompts/relevamiento');
    expect(call.system[0].text).toBe(SYSTEM_PROMPT_RELEVAMIENTO);

    // El bloque SRT (T-107) sigue viniendo aparte como system[1].
    expect(call.system).toHaveLength(2);
    expect(call.system[1].text).toContain('Criterios SRT');
  });
});
