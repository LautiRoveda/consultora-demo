/**
 * T-105 · Tests integration de getEppContextForEvents.
 *
 * Cobertura (3 tests):
 * 1. Happy path: helper resuelve empleado/item/entrega para un evento
 *    epp_entrega del mismo tenant.
 * 2. Cross-tenant defense: owner B llama el helper con un event de A
 *    (admin-fetched) — RLS bloquea los 3 SELECTs internos → context con
 *    todos los campos null.
 * 3. Degraded path: empleado archivado post-entrega → helper devuelve
 *    `empleado: null` mientras item y entrega siguen resolviendo.
 *
 * Correr local:
 *   set -a && source .env.local && set +a && \
 *     pnpm test:integration src/tests/integration/t105-epp-calendar-enrichment.test.ts
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
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

const slugA = `t105a-${runId}`;
const slugB = `t105b-${runId}`;
const emailOwnerA = `t105a-own-${runId}@example.com`;
const emailOwnerB = `t105b-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let clienteAId: string;
let empleadoAId: string;
let categoriaAId: string;
let itemAId: string;
let entregaAId: string;
let eventAId: string;

beforeAll(async () => {
  // Setup secuencial — lesson T-047: Promise.all sobre admin tiene flakiness
  // en sa-east-1 (UND_ERR ConnectTimeoutError).
  const resA = await admin
    .from('consultoras')
    .insert({ name: 'T105 cA', slug: slugA })
    .select('id')
    .single();
  if (resA.error || !resA.data) throw new Error(`insert cA: ${JSON.stringify(resA.error)}`);
  cAId = resA.data.id;

  const resB = await admin
    .from('consultoras')
    .insert({ name: 'T105 cB', slug: slugB })
    .select('id')
    .single();
  if (resB.error || !resB.data) throw new Error(`insert cB: ${JSON.stringify(resB.error)}`);
  cBId = resB.data.id;

  const uOA = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  if (uOA.error || !uOA.data.user)
    throw new Error(`createUser ownerA: ${JSON.stringify(uOA.error)}`);
  ownerAId = uOA.data.user.id;

  const uOB = await admin.auth.admin.createUser({
    email: emailOwnerB,
    password,
    email_confirm: true,
  });
  if (uOB.error || !uOB.data.user)
    throw new Error(`createUser ownerB: ${JSON.stringify(uOB.error)}`);
  ownerBId = uOB.data.user.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  // Fixtures cA: cliente + empleado + categoria + item no-descartable + entrega
  // + entrega_items + rpc → evento auto-creado.
  const cli = await admin
    .from('clientes')
    .insert({
      consultora_id: cAId,
      razon_social: `T105 cliente ${runId}`,
      cuit: '30-12345678-9',
    })
    .select('id')
    .single();
  if (cli.error || !cli.data) throw new Error(`insert cliente: ${JSON.stringify(cli.error)}`);
  clienteAId = cli.data.id;

  const emp = await admin
    .from('empleados')
    .insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'JuanT105',
      apellido: 'PerezT105',
      dni: '30123456',
    })
    .select('id')
    .single();
  if (emp.error || !emp.data) throw new Error(`insert empleado: ${JSON.stringify(emp.error)}`);
  empleadoAId = emp.data.id;

  const cat = await admin
    .from('epp_categorias')
    .insert({ consultora_id: cAId, nombre: `T105 Cabeza ${runId}` })
    .select('id')
    .single();
  if (cat.error || !cat.data) throw new Error(`insert categoria: ${JSON.stringify(cat.error)}`);
  categoriaAId = cat.data.id;

  const item = await admin
    .from('epp_items')
    .insert({
      consultora_id: cAId,
      categoria_id: categoriaAId,
      nombre: `T105 Casco ${runId}`,
      vida_util_meses: 6,
      es_descartable: false,
      requiere_numero_serie: false,
    })
    .select('id')
    .single();
  if (item.error || !item.data) throw new Error(`insert item: ${JSON.stringify(item.error)}`);
  itemAId = item.data.id;

  const entrega = await admin
    .from('epp_entregas')
    .insert({
      consultora_id: cAId,
      empleado_id: empleadoAId,
      cliente_id: clienteAId,
      fecha_entrega: new Date('2026-05-01T12:00:00Z').toISOString(),
      created_by: ownerAId,
    })
    .select('id')
    .single();
  if (entrega.error || !entrega.data)
    throw new Error(`insert entrega: ${JSON.stringify(entrega.error)}`);
  entregaAId = entrega.data.id;

  const entregaItem = await admin.from('epp_entrega_items').insert({
    entrega_id: entregaAId,
    item_id: itemAId,
    consultora_id: cAId,
    cantidad: 1,
    motivo_entrega: 'inicial',
  });
  if (entregaItem.error)
    throw new Error(`insert entrega_item: ${JSON.stringify(entregaItem.error)}`);

  // Invoca la funcion publica que genera epp_planificaciones + calendar_event
  // (security definer, solo service_role — admin client la puede llamar).
  const rpc = await admin.rpc('gen_epp_planificaciones_y_calendar_for', {
    p_entrega_id: entregaAId,
  });
  if (rpc.error) throw new Error(`rpc gen_epp: ${JSON.stringify(rpc.error)}`);

  const ev = await admin
    .from('calendar_events')
    .select('id')
    .eq('consultora_id', cAId)
    .eq('tipo', 'epp_entrega')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (ev.error || !ev.data) throw new Error(`fetch event: ${JSON.stringify(ev.error)}`);
  eventAId = ev.data.id;
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
  ]);
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

describe('T-105 getEppContextForEvents', () => {
  it('1. happy path: resuelve empleado + item + entrega para event epp_entrega del mismo tenant', async () => {
    await signInAs(emailOwnerA);
    const { getEppContextForEvents } = await import('@/app/(app)/calendario/queries');
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();

    // Fetch del event con su metadata via el client authed (RLS-respetuoso).
    const { data: event } = await sb
      .from('calendar_events')
      .select('*')
      .eq('id', eventAId)
      .single();
    expect(event).not.toBeNull();

    const result = await getEppContextForEvents(sb, [event!]);
    expect(result[eventAId]).toBeDefined();
    const ctx = result[eventAId]!;

    expect(ctx.empleado).not.toBeNull();
    expect(ctx.empleado?.id).toBe(empleadoAId);
    expect(ctx.empleado?.nombre).toBe('JuanT105');
    expect(ctx.empleado?.apellido).toBe('PerezT105');

    expect(ctx.item).not.toBeNull();
    expect(ctx.item?.id).toBe(itemAId);
    expect(ctx.item?.nombre).toBe(`T105 Casco ${runId}`);

    expect(ctx.entrega).not.toBeNull();
    expect(ctx.entrega?.id).toBe(entregaAId);
    // fecha_entrega volvio como ISO timestamptz — verificar el prefijo civil.
    expect(ctx.entrega?.fecha_entrega.slice(0, 10)).toBe('2026-05-01');
  });

  it('2. cross-tenant defense: owner B con event de A → context con todos los campos null (RLS bloquea SELECTs)', async () => {
    // Admin fetcha el event de A para simular el caller que pasa el row "a mano".
    // El helper recibe un client authed como B → los 3 SELECTs internos
    // filtran todo por RLS y los Maps salen vacios.
    const { data: eventOfA } = await admin
      .from('calendar_events')
      .select('*')
      .eq('id', eventAId)
      .single();
    expect(eventOfA).not.toBeNull();

    await signInAs(emailOwnerB);
    const { getEppContextForEvents } = await import('@/app/(app)/calendario/queries');
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sbB = await createServerClient();

    const result = await getEppContextForEvents(sbB, [eventOfA!]);

    // El helper SIGUE llenando la entry del Record con todos null (no la skipea
    // a nivel filtro porque tipo='epp_entrega' + metadata bien formado). La UI
    // muestra <eliminado> en cada slot.
    expect(result[eventAId]).toBeDefined();
    const ctx = result[eventAId]!;
    expect(ctx.empleado).toBeNull();
    expect(ctx.item).toBeNull();
    expect(ctx.entrega).toBeNull();
  });

  it('3. degraded path: empleado archivado → empleado null, item + entrega resuelven OK', async () => {
    // Archivar el empleado.
    const arch = await admin
      .from('empleados')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', empleadoAId);
    if (arch.error) throw new Error(`archive empleado: ${JSON.stringify(arch.error)}`);

    try {
      await signInAs(emailOwnerA);
      const { getEppContextForEvents } = await import('@/app/(app)/calendario/queries');
      const { createClient: createServerClient } = await import('@/shared/supabase/server');
      const sb = await createServerClient();

      const { data: event } = await sb
        .from('calendar_events')
        .select('*')
        .eq('id', eventAId)
        .single();
      expect(event).not.toBeNull();

      const result = await getEppContextForEvents(sb, [event!]);
      const ctx = result[eventAId]!;
      expect(ctx.empleado).toBeNull(); // archived → degraded
      expect(ctx.item).not.toBeNull(); // item sigue activo
      expect(ctx.entrega).not.toBeNull(); // entrega sin archived_at, intacta
    } finally {
      // Restore para evitar contaminar otros tests del runId.
      await admin.from('empleados').update({ archived_at: null }).eq('id', empleadoAId);
    }
  });
});
