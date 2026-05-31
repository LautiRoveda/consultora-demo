/**
 * T-106 · Tests integration del route handler POST /api/epp/sugerir-epp.
 *
 * Cubre:
 *  1. happy path — empleado con puestos + catálogo → suggestions enriquecidas.
 *  2. body inválido → 400 INVALID_INPUT.
 *  3. sin cookie → 401 UNAUTHENTICATED.
 *  4. user sin consultora → 403 NO_CONSULTORA.
 *  5. empleado de OTRA consultora (RLS) → 404 EMPLEADO_NOT_FOUND.
 *  6. empleado sin puestos → 200 con suggestions=[] + reason=NO_PUESTOS.
 *  7. Claude alucina item_id no presente en catálogo → filtrado en el server.
 *  8. dedup: Claude devuelve mismo item_id 2x → uno solo en respuesta.
 *
 * Mock Anthropic SDK: pattern de `informes-generate-stream-auth.test.ts`. La
 * lib NO se invoca en prod (sin Anthropic creds, los tests rompen) — el mock
 * provee shape { messages: { create: vi.fn() } }.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
const slugA = `t106s-a-${runId}`;
const slugB = `t106s-b-${runId}`;
const emailOwnerA = `t106s-a-${runId}@example.com`;
const emailOwnerB = `t106s-b-${runId}@example.com`;
const emailNoConsul = `t106s-noc-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let noConsulId: string;
let clienteAId: string;
let clienteBId: string;
let empleadoConPuestosAId: string; // 1 puesto + 0 entregas previas
let empleadoSinPuestosAId: string;
let empleadoBId: string; // en consultora B (para cross-tenant)
let puestoId: string;
let catCabezaId: string;
let itemCascoAId: string;
let itemBotaAId: string;

function makeCuit(prefix: string, base: string, check: string): string {
  return `${prefix}-${base.padStart(8, '0')}-${check}`;
}

beforeAll(async () => {
  cAId = (
    await admin.from('consultoras').insert({ name: 'T106S-A', slug: slugA }).select('id').single()
  ).data!.id;
  cBId = (
    await admin.from('consultoras').insert({ name: 'T106S-B', slug: slugB }).select('id').single()
  ).data!.id;

  ownerAId = (
    await admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true })
  ).data.user!.id;
  ownerBId = (
    await admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true })
  ).data.user!.id;
  noConsulId = (
    await admin.auth.admin.createUser({ email: emailNoConsul, password, email_confirm: true })
  ).data.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, {
      app_metadata: { consultora_id: cAId, consultora_role: 'owner' },
    }),
    admin.auth.admin.updateUserById(ownerBId, {
      app_metadata: { consultora_id: cBId, consultora_role: 'owner' },
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
  clienteBId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cBId,
        razon_social: `Cliente B ${runId}`,
        cuit: makeCuit('33', cuitBase, '2'),
        created_by: ownerBId,
      })
      .select('id')
      .single()
  ).data!.id;

  empleadoConPuestosAId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Pepe',
        apellido: 'Pereira',
        dni: '20444444',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  empleadoSinPuestosAId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Sole',
        apellido: 'Soto',
        dni: '20555555',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  empleadoBId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cBId,
        cliente_id: clienteBId,
        nombre: 'Carla',
        apellido: 'Castro',
        dni: '20666666',
        created_by: ownerBId,
      })
      .select('id')
      .single()
  ).data!.id;

  puestoId = (
    await admin
      .from('puestos')
      .insert({
        consultora_id: cAId,
        nombre: `Soldador ${runId}`,
        riesgos_asociados: ['proyeccion_particulas', 'radiacion_uv'],
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  await admin.from('empleados_puestos').insert({
    consultora_id: cAId,
    empleado_id: empleadoConPuestosAId,
    puesto_id: puestoId,
    asignado_por: ownerAId,
  });

  // Catálogo en A
  catCabezaId = (
    await admin
      .from('epp_categorias')
      .insert({ consultora_id: cAId, nombre: `Cabeza ${runId}`, created_by: ownerAId })
      .select('id')
      .single()
  ).data!.id;
  itemCascoAId = (
    await admin
      .from('epp_items')
      .insert({
        consultora_id: cAId,
        categoria_id: catCabezaId,
        nombre: `Casco ${runId}`,
        vida_util_meses: 24,
        es_descartable: false,
        requiere_numero_serie: false,
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  itemBotaAId = (
    await admin
      .from('epp_items')
      .insert({
        consultora_id: cAId,
        categoria_id: catCabezaId,
        nombre: `Bota ${runId}`,
        vida_util_meses: 12,
        es_descartable: false,
        requiere_numero_serie: false,
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
});

afterAll(async () => {
  await admin.from('epp_planificaciones').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('epp_entrega_items').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('epp_entregas').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('epp_items').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('epp_categorias').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('empleados_puestos').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('puestos').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('empleados').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('clientes').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('audit_log').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('consultora_members').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('consultoras').delete().in('id', [cAId, cBId]);
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
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
  return new NextRequest('http://localhost:3000/api/epp/sugerir-epp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: bodyStr,
  });
}

function mockToolUseResponse(recommendations: unknown, usage = { input: 800, output: 200 }) {
  mockMessagesCreate.mockResolvedValueOnce({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: 'recommend_epp_items',
        input: { recommendations },
      },
    ],
    usage: { input_tokens: usage.input, output_tokens: usage.output },
  });
}

describe('POST /api/epp/sugerir-epp', () => {
  it('1. happy path: empleado con puestos + catálogo → suggestions enriquecidas + log tokens', async () => {
    await signInAs(emailOwnerA);
    mockToolUseResponse([
      {
        item_id: itemCascoAId,
        confianza_porcentaje: 95,
        justificacion: 'Riesgo proyección + radiación UV. IRAM 3620.',
      },
      {
        item_id: itemBotaAId,
        confianza_porcentaje: 70,
        justificacion: 'Buena práctica de calzado de seguridad.',
      },
    ]);
    const { POST } = await import('@/app/api/epp/sugerir-epp/route');
    const res = await POST(makeReq({ empleado_id: empleadoConPuestosAId }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      suggestions: Array<{ item_id: string; item_nombre: string; categoria_nombre: string }>;
      puestos_considerados: Array<{ puesto_id: string }>;
      tokens_used: { input: number; output: number; cost_usd: number };
      model: string;
    };
    expect(body.suggestions).toHaveLength(2);
    const ids = body.suggestions.map((s) => s.item_id);
    expect(ids).toContain(itemCascoAId);
    expect(ids).toContain(itemBotaAId);
    // Enrichment: nombre + categoria vienen del catálogo, no de la IA.
    const casco = body.suggestions.find((s) => s.item_id === itemCascoAId);
    expect(casco?.item_nombre).toMatch(/Casco/);
    expect(casco?.categoria_nombre).toMatch(/Cabeza/);
    expect(body.puestos_considerados).toHaveLength(1);
    expect(body.tokens_used.input).toBe(800);
    expect(body.tokens_used.output).toBe(200);
    expect(body.tokens_used.cost_usd).toBeGreaterThan(0);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(mockMessagesCreate).toHaveBeenCalledOnce();
  });

  it('2. body inválido (empleado_id no UUID) → 400 INVALID_INPUT', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/epp/sugerir-epp/route');
    const res = await POST(makeReq({ empleado_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_INPUT');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('3. sin cookie de sesión → 401 UNAUTHENTICATED', async () => {
    const { POST } = await import('@/app/api/epp/sugerir-epp/route');
    const res = await POST(makeReq({ empleado_id: empleadoConPuestosAId }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('4. user sin consultora → 403 NO_CONSULTORA', async () => {
    await signInAs(emailNoConsul);
    const { POST } = await import('@/app/api/epp/sugerir-epp/route');
    const res = await POST(makeReq({ empleado_id: empleadoConPuestosAId }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NO_CONSULTORA');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('5. empleado de otra consultora (RLS scope) → 404 EMPLEADO_NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/epp/sugerir-epp/route');
    const res = await POST(makeReq({ empleado_id: empleadoBId }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('EMPLEADO_NOT_FOUND');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('6. empleado sin puestos → 200 con suggestions=[] + reason=NO_PUESTOS', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/epp/sugerir-epp/route');
    const res = await POST(makeReq({ empleado_id: empleadoSinPuestosAId }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: unknown[]; reason: string };
    expect(body.suggestions).toEqual([]);
    expect(body.reason).toBe('NO_PUESTOS');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('7. Claude alucina item_id inexistente → filtrado en server (defensa)', async () => {
    await signInAs(emailOwnerA);
    // UUID v4 sintácticamente válido pero no presente en el catálogo.
    const inventado = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    mockToolUseResponse([
      {
        item_id: itemCascoAId,
        confianza_porcentaje: 90,
        justificacion: 'OK.',
      },
      {
        item_id: inventado,
        confianza_porcentaje: 95,
        justificacion: 'Alucinación.',
      },
    ]);
    const { POST } = await import('@/app/api/epp/sugerir-epp/route');
    const res = await POST(makeReq({ empleado_id: empleadoConPuestosAId }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      suggestions: Array<{ item_id: string }>;
    };
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]?.item_id).toBe(itemCascoAId);
  });

  it('8. dedup: Claude devuelve mismo item_id dos veces → uno solo en respuesta', async () => {
    await signInAs(emailOwnerA);
    mockToolUseResponse([
      {
        item_id: itemCascoAId,
        confianza_porcentaje: 90,
        justificacion: 'Primera.',
      },
      {
        item_id: itemCascoAId,
        confianza_porcentaje: 80,
        justificacion: 'Segunda repetida.',
      },
    ]);
    const { POST } = await import('@/app/api/epp/sugerir-epp/route');
    const res = await POST(makeReq({ empleado_id: empleadoConPuestosAId }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      suggestions: Array<{ item_id: string; confianza_porcentaje: number }>;
    };
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]?.confianza_porcentaje).toBe(90); // primera gana
  });
});
