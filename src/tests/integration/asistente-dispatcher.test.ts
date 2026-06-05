/**
 * T-117 · Tests integration del DISPATCHER del asistente IA de EPP.
 *
 * El dispatcher es Anthropic-free → se testea determinísticamente contra una DB
 * sembrada, sin mockear el LLM. Cubre:
 *  1. cada tool devuelve los datos reales del tenant.
 *  2. result shaping: NO se filtran ids internos (cuil, ids, calendar_event_id, cliente_id).
 *  3. cross-tenant (empleado_id de otra consultora) → vacío (RLS).
 *  4. input inválido / tool desconocida → tool_result con isError, sin tirar.
 *
 * Inserts directos con admin client (service role); RLS se valida desde el server
 * client autenticado. Mismo patrón que epp-padron-page.test.ts.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
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
const slugA = `t117d-a-${runId}`;
const slugB = `t117d-b-${runId}`;
const emailOwnerA = `t117d-a-${runId}@example.com`;
const emailOwnerB = `t117d-b-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let clienteAId: string;
let clienteBId: string;
let empleadoAId: string;
let empleadoBId: string;
let lautaroId: string; // FU1: nombre+apellido + acentos
let perezId: string; // FU1: apellido con tilde
let categoriaAId: string;
let itemCascoId: string;

function makeCuit(prefix: string, base: string, check: string): string {
  return `${prefix}-${base.padStart(8, '0')}-${check}`;
}

beforeAll(async () => {
  cAId = (await createTestConsultora(admin, { name: 'T117D-A', slug: slugA })).id;
  cBId = (await createTestConsultora(admin, { name: 'T117D-B', slug: slugB })).id;

  ownerAId = (
    await admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true })
  ).data.user!.id;
  ownerBId = (
    await admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true })
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

  empleadoAId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Pepe',
        apellido: 'Pereira',
        dni: '20444444',
        puesto: 'Soldador',
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

  // FU1: empleados para la búsqueda robusta (nombre+apellido, orden libre, acentos).
  lautaroId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Lautaro',
        apellido: 'Roveda',
        dni: '30222333',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  perezId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Juan',
        apellido: 'Pérez',
        dni: '27888999',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;

  categoriaAId = (
    await admin
      .from('epp_categorias')
      .insert({ consultora_id: cAId, nombre: `Cabeza ${runId}`, created_by: ownerAId })
      .select('id')
      .single()
  ).data!.id;
  itemCascoId = (
    await admin
      .from('epp_items')
      .insert({
        consultora_id: cAId,
        categoria_id: categoriaAId,
        nombre: `Casco ${runId}`,
        vida_util_meses: 24,
        es_descartable: false,
        requiere_numero_serie: false,
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;

  const today = new Date();
  const entregaId = (
    await admin
      .from('epp_entregas')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        empleado_id: empleadoAId,
        fecha_entrega: today.toISOString().slice(0, 10),
        firmado_at: today.toISOString(),
        firma_storage_path: `${cAId}/fake.png`,
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  await admin.from('epp_entrega_items').insert({
    consultora_id: cAId,
    entrega_id: entregaId,
    item_id: itemCascoId,
    cantidad: 1,
    motivo_entrega: 'inicial',
  });

  const proxima = new Date();
  proxima.setDate(proxima.getDate() + 15);
  await admin.from('epp_planificaciones').insert({
    consultora_id: cAId,
    empleado_id: empleadoAId,
    item_id: itemCascoId,
    generado_de_entrega_id: entregaId,
    fecha_proxima_entrega: proxima.toISOString().slice(0, 10),
    frecuencia_meses: 6,
    estado: 'activa',
  });
});

afterAll(async () => {
  await admin.from('epp_planificaciones').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('epp_entrega_items').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('epp_entregas').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('epp_items').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('epp_categorias').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('empleados').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('clientes').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('consultora_members').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('consultoras').delete().in('id', [cAId, cBId]);
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
});

beforeEach(() => {
  cookieStore.length = 0;
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

async function rlsClient() {
  const { createClient } = await import('@/shared/supabase/server');
  return createClient();
}

describe('dispatchTool', () => {
  it('1. buscar_empleado por nombre → empleado real, sin cuil', async () => {
    await signInAs(emailOwnerA);
    const { dispatchTool } = await import('@/shared/ai/epp-chat-tools');
    const supabase = await rlsClient();

    const res = await dispatchTool({
      name: 'buscar_empleado',
      input: { query: 'Pereira' },
      supabase,
      consultoraId: cAId,
    });
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.content) as Array<Record<string, unknown>>;
    const found = rows.find((r) => r.id === empleadoAId);
    expect(found).toBeDefined();
    expect(found).toMatchObject({
      nombre: 'Pepe',
      apellido: 'Pereira',
      dni: '20444444',
      puesto: 'Soldador',
    });
    expect(res.content).not.toContain('cuil');
  });

  it('2. buscar_empleado por DNI (numérico) → empleado real', async () => {
    await signInAs(emailOwnerA);
    const { dispatchTool } = await import('@/shared/ai/epp-chat-tools');
    const supabase = await rlsClient();

    const res = await dispatchTool({
      name: 'buscar_empleado',
      input: { query: '20444' },
      supabase,
      consultoraId: cAId,
    });
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.content) as Array<Record<string, unknown>>;
    expect(rows.some((r) => r.id === empleadoAId)).toBe(true);
  });

  it('3. epp_entregado_a_empleado → entrega real, sin ids internos', async () => {
    await signInAs(emailOwnerA);
    const { dispatchTool } = await import('@/shared/ai/epp-chat-tools');
    const supabase = await rlsClient();

    const res = await dispatchTool({
      name: 'epp_entregado_a_empleado',
      input: { empleado_id: empleadoAId },
      supabase,
      consultoraId: cAId,
    });
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.content) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const entrega = rows[0]!;
    expect(entrega.firmado).toBe(true);
    expect(Object.keys(entrega)).not.toContain('id');
    const items = entrega.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({ cantidad: 1, motivo: 'inicial' });
    expect(items[0]?.nombre).toContain('Casco');
    expect(Object.keys(items[0]!)).not.toContain('id');
  });

  it('4. vencimientos_epp_de_empleado → planificación real, sin calendar_event_id', async () => {
    await signInAs(emailOwnerA);
    const { dispatchTool } = await import('@/shared/ai/epp-chat-tools');
    const supabase = await rlsClient();

    const res = await dispatchTool({
      name: 'vencimientos_epp_de_empleado',
      input: { empleado_id: empleadoAId },
      supabase,
      consultoraId: cAId,
    });
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.content) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ frecuencia_meses: 6 });
    expect(rows[0]?.item_nombre).toContain('Casco');
    expect(res.content).not.toContain('calendar_event_id');
    expect(res.content).not.toContain('item_id');
  });

  it('5. vencimientos_epp_proximos → empleado con pendientes, sin ids', async () => {
    await signInAs(emailOwnerA);
    const { dispatchTool } = await import('@/shared/ai/epp-chat-tools');
    const supabase = await rlsClient();

    const res = await dispatchTool({
      name: 'vencimientos_epp_proximos',
      input: {},
      supabase,
      consultoraId: cAId,
    });
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.content) as Array<Record<string, unknown>>;
    const mine = rows.find((r) => r.dni === '20444444');
    expect(mine).toBeDefined();
    expect(mine!.pendientes_proximos_count).toBeGreaterThanOrEqual(1);
    expect(res.content).not.toContain('empleado_id');
    expect(res.content).not.toContain('cliente_id');
  });

  it('6. cross-tenant: empleado_id de otra consultora → vacío', async () => {
    await signInAs(emailOwnerA);
    const { dispatchTool } = await import('@/shared/ai/epp-chat-tools');
    const supabase = await rlsClient();

    const entregas = await dispatchTool({
      name: 'epp_entregado_a_empleado',
      input: { empleado_id: empleadoBId },
      supabase,
      consultoraId: cAId,
    });
    expect(entregas.isError).toBe(false);
    expect(JSON.parse(entregas.content)).toEqual([]);

    const vto = await dispatchTool({
      name: 'vencimientos_epp_de_empleado',
      input: { empleado_id: empleadoBId },
      supabase,
      consultoraId: cAId,
    });
    expect(JSON.parse(vto.content)).toEqual([]);
  });

  it('7. input inválido / tool desconocida → isError, sin tirar', async () => {
    await signInAs(emailOwnerA);
    const { dispatchTool } = await import('@/shared/ai/epp-chat-tools');
    const supabase = await rlsClient();

    const badInput = await dispatchTool({
      name: 'epp_entregado_a_empleado',
      input: { empleado_id: 'no-es-uuid' },
      supabase,
      consultoraId: cAId,
    });
    expect(badInput.isError).toBe(true);

    const unknown = await dispatchTool({
      name: 'tool_que_no_existe',
      input: {},
      supabase,
      consultoraId: cAId,
    });
    expect(unknown.isError).toBe(true);
  });
});

describe('buscar_empleado robusto (T-117-FU1)', () => {
  async function buscarIds(query: string): Promise<string[]> {
    await signInAs(emailOwnerA);
    const { dispatchTool } = await import('@/shared/ai/epp-chat-tools');
    const supabase = await rlsClient();
    const res = await dispatchTool({
      name: 'buscar_empleado',
      input: { query },
      supabase,
      consultoraId: cAId,
    });
    expect(res.isError).toBe(false);
    return (JSON.parse(res.content) as Array<{ id: string }>).map((r) => r.id);
  }

  it('nombre + apellido juntos, en cualquier orden, encuentran al empleado', async () => {
    expect(await buscarIds('lautaro roveda')).toContain(lautaroId);
    expect(await buscarIds('roveda lautaro')).toContain(lautaroId);
  });

  it('un solo término en mayúsculas encuentra por apellido', async () => {
    expect(await buscarIds('ROVEDA')).toContain(lautaroId);
  });

  it('accent-insensitive: "perez" (sin tilde) encuentra a "Pérez"', async () => {
    expect(await buscarIds('perez')).toContain(perezId);
  });

  it('DNI (rama dígitos) sigue funcionando', async () => {
    expect(await buscarIds('30222333')).toContain(lautaroId);
  });

  it('nombre inexistente → []', async () => {
    expect(await buscarIds('noexiste zzz')).toEqual([]);
  });

  it('cross-tenant: el apellido de un empleado de B no aparece logueado como A', async () => {
    // "Castro" vive en la consultora B; A no debe verlo (RLS) → no aparece en resultados.
    expect(await buscarIds('castro')).not.toContain(empleadoBId);
  });
});
