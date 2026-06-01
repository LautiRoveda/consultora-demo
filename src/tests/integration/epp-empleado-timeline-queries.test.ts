/**
 * T-109 · Tests de integration de las queries de timeline EPP por empleado.
 *
 * Cubre (gate Pieza A — cross-tenant con 2 consultoras):
 *  - getEntregasByEmpleado: owner ve sus entregas con items+categoría, orden
 *    desc por fecha_entrega, paginación (limit/offset), y cross-tenant -> [].
 *  - getPlanificacionesActivasByEmpleado: owner ve sus planificaciones activas
 *    con item_nombre, orden asc, y cross-tenant -> [].
 *
 * Mismo harness que epp-entregas-queries.test.ts: 2 consultoras reales, owners
 * con claim JWT, entregas creadas via createEntregaAction (shape de producción).
 *
 * Correr local:
 *   `set -a && source .env.local && set +a && pnpm test:integration -- epp-empleado-timeline-queries`
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error('Tests requieren env Supabase.');

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const FIRMA_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';
const slugA = `t109qa-${runId}`;
const slugB = `t109qb-${runId}`;
const emailOwnerA = `t109qa-own-${runId}@example.com`;
const emailOwnerB = `t109qb-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let clienteAId: string;
let clienteBId: string;
let empleadoAId: string;
let empleadoBId: string;
let itemSimpleAId: string;
let itemSimpleBId: string;

const trackedEntregas: string[] = [];
const trackedStorage: string[] = [];

beforeAll(async () => {
  cAId = (
    await admin.from('consultoras').insert({ name: 'T109QA', slug: slugA }).select('id').single()
  ).data!.id;
  cBId = (
    await admin.from('consultoras').insert({ name: 'T109QB', slug: slugB }).select('id').single()
  ).data!.id;

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
  await admin.auth.admin.updateUserById(ownerAId, {
    app_metadata: { consultora_id: cAId, consultora_role: 'owner' },
  });
  await admin.auth.admin.updateUserById(ownerBId, {
    app_metadata: { consultora_id: cBId, consultora_role: 'owner' },
  });

  const cuitBaseQ = Date.now().toString().slice(-8).padStart(8, '0');
  const cuitQA = `33-${cuitBaseQ}-3`;
  const cuitQB = `23-${cuitBaseQ}-4`;

  clienteAId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Cliente QA ${runId}`,
        cuit: cuitQA,
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
        razon_social: `Cliente QB ${runId}`,
        cuit: cuitQB,
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
        nombre: 'Ana',
        apellido: 'Lopez',
        dni: '20555666',
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
        nombre: 'Mario',
        apellido: 'Diaz',
        dni: '20777888',
        created_by: ownerBId,
      })
      .select('id')
      .single()
  ).data!.id;

  const categoriaAId = (
    await admin
      .from('epp_categorias')
      .insert({ consultora_id: cAId, nombre: `CatQ A ${runId}`, created_by: ownerAId })
      .select('id')
      .single()
  ).data!.id;

  // es_descartable=false -> cada entrega firmada genera una planificación.
  itemSimpleAId = (
    await admin
      .from('epp_items')
      .insert({
        consultora_id: cAId,
        categoria_id: categoriaAId,
        nombre: `Casco Q ${runId}`,
        vida_util_meses: 24,
        es_descartable: false,
        requiere_numero_serie: false,
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;

  const categoriaBId = (
    await admin
      .from('epp_categorias')
      .insert({ consultora_id: cBId, nombre: `CatQ B ${runId}`, created_by: ownerBId })
      .select('id')
      .single()
  ).data!.id;

  itemSimpleBId = (
    await admin
      .from('epp_items')
      .insert({
        consultora_id: cBId,
        categoria_id: categoriaBId,
        nombre: `Casco QB ${runId}`,
        vida_util_meses: 24,
        es_descartable: false,
        requiere_numero_serie: false,
        created_by: ownerBId,
      })
      .select('id')
      .single()
  ).data!.id;

  // 2 entregas firmadas para empleado A, 1 para empleado B — via la server
  // action (shape consistente con producción: header + items + planificación).
  await signInAs(emailOwnerA);
  const { createEntregaAction } = await import('@/app/(app)/epp/entregas/actions');

  for (let i = 0; i < 2; i += 1) {
    const r = await createEntregaAction({
      empleado_id: empleadoAId,
      items: [{ item_id: itemSimpleAId, cantidad: 1, motivo_entrega: 'inicial' }],
      firma_base64: FIRMA_PNG_BASE64,
    });
    if (r.ok) {
      trackedEntregas.push(r.entregaId);
      trackedStorage.push(`${cAId}/${r.entregaId}.png`);
    }
  }

  await signInAs(emailOwnerB);
  const rB = await createEntregaAction({
    empleado_id: empleadoBId,
    items: [{ item_id: itemSimpleBId, cantidad: 1, motivo_entrega: 'inicial' }],
    firma_base64: FIRMA_PNG_BASE64,
  });
  if (rB.ok) {
    trackedEntregas.push(rB.entregaId);
    trackedStorage.push(`${cBId}/${rB.entregaId}.png`);
  }
});

afterAll(async () => {
  if (trackedStorage.length > 0) {
    await admin.storage
      .from('epp-firmas')
      .remove(trackedStorage)
      .catch(() => {});
  }
  if (trackedEntregas.length > 0) {
    await admin
      .from('epp_planificaciones')
      .delete()
      .in('generado_de_entrega_id', trackedEntregas)
      .then(() => {});
    await admin
      .from('calendar_events')
      .delete()
      .in('consultora_id', [cAId, cBId])
      .eq('tipo', 'epp_entrega')
      .then(() => {});
    await admin
      .from('epp_entrega_items')
      .delete()
      .in('entrega_id', trackedEntregas)
      .then(() => {});
    await admin
      .from('epp_entregas')
      .delete()
      .in('id', trackedEntregas)
      .then(() => {});
  }
  await admin
    .from('epp_items')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('epp_categorias')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('empleados')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('clientes')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('consultora_members')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('consultoras')
    .delete()
    .in('id', [cAId, cBId])
    .then(() => {});
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

describe('getEntregasByEmpleado', () => {
  it('1. owner A ve la timeline de su empleado con items + categoría, orden desc', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { getEntregasByEmpleado } = await import('@/app/(app)/epp/entregas/queries');

    const entregas = await getEntregasByEmpleado(sb, empleadoAId);
    expect(entregas.length).toBeGreaterThanOrEqual(2);

    // Cada entrega trae sus items con nombre + categoría resueltos (no N+1).
    for (const e of entregas) {
      expect(e.items.length).toBeGreaterThanOrEqual(1);
      expect(e.items[0]?.item_nombre).toContain('Casco Q');
      expect(e.items[0]?.categoria_nombre).toContain('CatQ A');
      expect(e.items[0]?.motivo_entrega).toBe('inicial');
    }

    // Orden desc por fecha_entrega (más reciente primero). ISO strings comparan
    // lexicográficamente.
    for (let i = 0; i < entregas.length - 1; i += 1) {
      expect(entregas[i]!.fecha_entrega >= entregas[i + 1]!.fecha_entrega).toBe(true);
    }
  });

  it('2. cross-tenant: owner A pide el empleado de B -> [] (RLS)', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { getEntregasByEmpleado } = await import('@/app/(app)/epp/entregas/queries');

    const entregas = await getEntregasByEmpleado(sb, empleadoBId);
    expect(entregas).toEqual([]);
  });

  it('3. paginación: limit/offset devuelven páginas disjuntas', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { getEntregasByEmpleado } = await import('@/app/(app)/epp/entregas/queries');

    const page0 = await getEntregasByEmpleado(sb, empleadoAId, { limit: 1, offset: 0 });
    const page1 = await getEntregasByEmpleado(sb, empleadoAId, { limit: 1, offset: 1 });
    expect(page0.length).toBe(1);
    expect(page1.length).toBe(1);
    expect(page0[0]!.id).not.toBe(page1[0]!.id);
  });
});

describe('getPlanificacionesActivasByEmpleado', () => {
  it('4. owner A ve planificaciones activas de su empleado con item_nombre, orden asc', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { getPlanificacionesActivasByEmpleado } =
      await import('@/app/(app)/epp/entregas/queries');

    const planis = await getPlanificacionesActivasByEmpleado(sb, empleadoAId);
    expect(planis.length).toBeGreaterThanOrEqual(1);
    expect(planis[0]?.item_nombre).toContain('Casco Q');
    expect(planis[0]?.frecuencia_meses).toBeGreaterThan(0);

    for (let i = 0; i < planis.length - 1; i += 1) {
      expect(planis[i]!.fecha_proxima_entrega <= planis[i + 1]!.fecha_proxima_entrega).toBe(true);
    }
  });

  it('5. cross-tenant: owner A pide planificaciones del empleado de B -> [] (RLS)', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { getPlanificacionesActivasByEmpleado } =
      await import('@/app/(app)/epp/entregas/queries');

    const planis = await getPlanificacionesActivasByEmpleado(sb, empleadoBId);
    expect(planis).toEqual([]);
  });
});
