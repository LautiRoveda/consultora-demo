/**
 * T-106 · Tests integration de queries del padrón EPP.
 *
 * Cobertura:
 *  - listEmpleadosConEstadoEpp retorna shape con aggregates (puestos_count,
 *    ultima_entrega, pendientes_proximos_count).
 *  - Filter por clienteId.
 *  - Cross-tenant scope vía RLS.
 *  - Empty state (consultora sin empleados).
 *
 * Inserts directos con admin client (service role) — no usamos createEntregaAction
 * para evitar dependencia con storage. RLS se valida desde el server client
 * autenticado.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
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
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';
const slugA = `t106p-a-${runId}`;
const slugB = `t106p-b-${runId}`;
const emailOwnerA = `t106p-a-${runId}@example.com`;
const emailOwnerB = `t106p-b-${runId}@example.com`;
const emailEmpty = `t106p-empty-${runId}@example.com`;

let cAId: string;
let cBId: string;
let cEmptyId: string;
let ownerAId: string;
let ownerBId: string;
let emptyOwnerId: string;
let clienteA1Id: string;
let clienteA2Id: string;
let clienteBId: string;
let empleadoA1Id: string; // 2 puestos + 1 entrega + 1 planificación 30d
let empleadoA2Id: string; // sin puestos
let empleadoBId: string;
let puestoSoldadorId: string;
let puestoOperarioId: string;
let categoriaAId: string;
let itemCascoId: string;

function makeCuit(prefix: string, base: string, check: string): string {
  return `${prefix}-${base.padStart(8, '0')}-${check}`;
}

beforeAll(async () => {
  // Consultoras
  cAId = (
    await admin.from('consultoras').insert({ name: 'T106P-A', slug: slugA }).select('id').single()
  ).data!.id;
  cBId = (
    await admin.from('consultoras').insert({ name: 'T106P-B', slug: slugB }).select('id').single()
  ).data!.id;
  cEmptyId = (
    await admin
      .from('consultoras')
      .insert({ name: 'T106P-Empty', slug: `t106p-empty-${runId}` })
      .select('id')
      .single()
  ).data!.id;

  // Users + membership
  ownerAId = (
    await admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true })
  ).data.user!.id;
  ownerBId = (
    await admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true })
  ).data.user!.id;
  emptyOwnerId = (
    await admin.auth.admin.createUser({ email: emailEmpty, password, email_confirm: true })
  ).data.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
    { user_id: emptyOwnerId, consultora_id: cEmptyId, role: 'owner' },
  ]);
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, {
      app_metadata: { consultora_id: cAId, consultora_role: 'owner' },
    }),
    admin.auth.admin.updateUserById(ownerBId, {
      app_metadata: { consultora_id: cBId, consultora_role: 'owner' },
    }),
    admin.auth.admin.updateUserById(emptyOwnerId, {
      app_metadata: { consultora_id: cEmptyId, consultora_role: 'owner' },
    }),
  ]);

  // Clientes (2 en A, 1 en B). 3 prefijos distintos garantizan unicidad.
  const cuitBase = Date.now().toString().slice(-8);
  clienteA1Id = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Cliente A1 ${runId}`,
        cuit: makeCuit('30', cuitBase, '1'),
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  clienteA2Id = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Cliente A2 ${runId}`,
        cuit: makeCuit('33', cuitBase, '2'),
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
        cuit: makeCuit('34', cuitBase, '3'),
        created_by: ownerBId,
      })
      .select('id')
      .single()
  ).data!.id;

  // Empleados
  empleadoA1Id = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteA1Id,
        nombre: 'Ana',
        apellido: 'Alvarez',
        dni: '20111111',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  empleadoA2Id = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteA2Id,
        nombre: 'Beto',
        apellido: 'Benitez',
        dni: '20222222',
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
        dni: '20333333',
        created_by: ownerBId,
      })
      .select('id')
      .single()
  ).data!.id;

  // Puestos (en A) + asignación al empleado A1
  puestoSoldadorId = (
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
  puestoOperarioId = (
    await admin
      .from('puestos')
      .insert({
        consultora_id: cAId,
        nombre: `Operario ${runId}`,
        riesgos_asociados: ['ruido'],
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;

  await admin.from('empleados_puestos').insert([
    {
      consultora_id: cAId,
      empleado_id: empleadoA1Id,
      puesto_id: puestoSoldadorId,
      asignado_por: ownerAId,
    },
    {
      consultora_id: cAId,
      empleado_id: empleadoA1Id,
      puesto_id: puestoOperarioId,
      asignado_por: ownerAId,
    },
  ]);

  // Catálogo + entrega firmada en A1
  categoriaAId = (
    await admin
      .from('epp_categorias')
      .insert({
        consultora_id: cAId,
        nombre: `Cabeza ${runId}`,
        created_by: ownerAId,
      })
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
  const todayIso = today.toISOString().slice(0, 10);
  const entregaId = (
    await admin
      .from('epp_entregas')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteA1Id,
        empleado_id: empleadoA1Id,
        fecha_entrega: todayIso,
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

  // Planificación con fecha dentro de los próximos 30 días.
  const proxima = new Date();
  proxima.setDate(proxima.getDate() + 15);
  await admin.from('epp_planificaciones').insert({
    consultora_id: cAId,
    empleado_id: empleadoA1Id,
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
  await admin.from('empleados_puestos').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('puestos').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('empleados').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('clientes').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('consultora_members').delete().in('consultora_id', [cAId, cBId, cEmptyId]);
  await admin.from('consultoras').delete().in('id', [cAId, cBId, cEmptyId]);
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
  await admin.auth.admin.deleteUser(emptyOwnerId).catch(() => {});
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

describe('listEmpleadosConEstadoEpp', () => {
  it('1. retorna empleados del tenant con aggregates correctos', async () => {
    await signInAs(emailOwnerA);
    const { createClient } = await import('@/shared/supabase/server');
    const { listEmpleadosConEstadoEpp } = await import('@/app/(app)/epp/padron/queries');
    const supabase = await createClient();

    const rows = await listEmpleadosConEstadoEpp(supabase);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const a1 = rows.find((r) => r.empleado_id === empleadoA1Id);
    const a2 = rows.find((r) => r.empleado_id === empleadoA2Id);

    expect(a1).toBeDefined();
    expect(a1!.puestos_count).toBe(2);
    expect(a1!.ultima_entrega).not.toBeNull();
    expect(a1!.pendientes_proximos_count).toBe(1);
    expect(a1!.cliente_razon_social).toContain('Cliente A1');

    expect(a2).toBeDefined();
    expect(a2!.puestos_count).toBe(0);
    expect(a2!.ultima_entrega).toBeNull();
    expect(a2!.pendientes_proximos_count).toBe(0);
  });

  it('2. filtra por clienteId — retorna solo empleados de ese cliente', async () => {
    await signInAs(emailOwnerA);
    const { createClient } = await import('@/shared/supabase/server');
    const { listEmpleadosConEstadoEpp } = await import('@/app/(app)/epp/padron/queries');
    const supabase = await createClient();

    const rows = await listEmpleadosConEstadoEpp(supabase, { clienteId: clienteA1Id });
    expect(rows.length).toBe(1);
    expect(rows[0]?.empleado_id).toBe(empleadoA1Id);
  });

  it('3. cross-tenant: ownerB NO ve empleados de A', async () => {
    await signInAs(emailOwnerB);
    const { createClient } = await import('@/shared/supabase/server');
    const { listEmpleadosConEstadoEpp } = await import('@/app/(app)/epp/padron/queries');
    const supabase = await createClient();

    const rows = await listEmpleadosConEstadoEpp(supabase);
    const empleadoIds = rows.map((r) => r.empleado_id);
    expect(empleadoIds).not.toContain(empleadoA1Id);
    expect(empleadoIds).not.toContain(empleadoA2Id);
    expect(empleadoIds).toContain(empleadoBId);
  });

  it('4. empty state: consultora sin empleados retorna []', async () => {
    await signInAs(emailEmpty);
    const { createClient } = await import('@/shared/supabase/server');
    const { listEmpleadosConEstadoEpp } = await import('@/app/(app)/epp/padron/queries');
    const supabase = await createClient();

    const rows = await listEmpleadosConEstadoEpp(supabase);
    expect(rows).toEqual([]);
  });
});
