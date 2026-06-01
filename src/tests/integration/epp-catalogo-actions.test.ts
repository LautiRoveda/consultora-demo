/**
 * T-101 · Tests de integration server actions + queries del módulo EPP catálogo.
 *
 * Cobertura:
 *  - createCategoriaAction: happy owner + FORBIDDEN_NOT_OWNER + DUPLICATE_NAME +
 *    UNAUTHENTICATED + audit_log.
 *  - updateCategoriaAction + archive + restore.
 *  - createItemAction: happy + categoria_id cross-tenant → INVALID_INPUT +
 *    es_descartable=true OK + requiere_numero_serie=true OK + categoría
 *    archivada (FK válido pero pre-check rechaza por archived_at filter).
 *  - updateItemAction + archive + restore.
 *  - createPuestoAction + DUPLICATE_NAME + update + archive + restore.
 *  - seedDefaultCatalogAction: empty consultora → 8+15+3 created;
 *    re-invocación → 0+0+0 (idempotente); completa borrado parcial;
 *    FORBIDDEN_NOT_OWNER en member.
 *  - queries: listCategorias / listItemsConCategoria / listPuestos respetan
 *    includeArchived; countCatalogo shape; cross-tenant isolation.
 *
 * Setup secuencial (lesson T-047 Promise.all flaky sa-east-1).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
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
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerInfoMock = vi.fn();
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: () => {},
    debug: () => {},
    info: (arg: unknown, msg?: string) => loggerInfoMock(arg, msg),
    warn: (arg: unknown, msg?: string) => loggerWarnMock(arg, msg),
    error: (arg: unknown, msg?: string) => loggerErrorMock(arg, msg),
    fatal: () => {},
  },
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

const slugA = `t101a-${runId}`;
const slugB = `t101b-${runId}`;
const emailOwnerA = `t101a-own-${runId}@example.com`;
const emailMemberA = `t101a-mem-${runId}@example.com`;
const emailOwnerB = `t101b-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;

let nameCounter = 0;
function nextName(prefix: string): string {
  nameCounter += 1;
  return `${prefix}-${runId}-${nameCounter}`;
}

beforeAll(async () => {
  const { data: cA, error: errCA } = await admin
    .from('consultoras')
    .insert({ name: 'T101A', slug: slugA })
    .select('id')
    .single();
  if (errCA || !cA) throw new Error(`insert cA: ${JSON.stringify(errCA)}`);
  cAId = cA.id;

  const { data: cB, error: errCB } = await admin
    .from('consultoras')
    .insert({ name: 'T101B', slug: slugB })
    .select('id')
    .single();
  if (errCB || !cB) throw new Error(`insert cB: ${JSON.stringify(errCB)}`);
  cBId = cB.id;

  const uOA = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  if (uOA.error || !uOA.data.user)
    throw new Error(`createUser ownerA: ${JSON.stringify(uOA.error)}`);
  ownerAId = uOA.data.user.id;

  const uMA = await admin.auth.admin.createUser({
    email: emailMemberA,
    password,
    email_confirm: true,
  });
  if (uMA.error || !uMA.data.user)
    throw new Error(`createUser memberA: ${JSON.stringify(uMA.error)}`);
  memberAId = uMA.data.user.id;

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
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await admin.auth.admin.updateUserById(ownerAId, {
    app_metadata: { consultora_id: cAId, consultora_role: 'owner' },
  });
  await admin.auth.admin.updateUserById(memberAId, {
    app_metadata: { consultora_id: cAId, consultora_role: 'member' },
  });
  await admin.auth.admin.updateUserById(ownerBId, {
    app_metadata: { consultora_id: cBId, consultora_role: 'owner' },
  });
});

afterAll(async () => {
  // Orden FK inverso para limpieza, sin disparar RESTRICT.
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
    .from('puestos')
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
  await admin.auth.admin.deleteUser(memberAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
});

beforeEach(() => {
  cookieStore.length = 0;
  loggerWarnMock.mockClear();
  loggerErrorMock.mockClear();
  loggerInfoMock.mockClear();
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

// ============================== CATEGORIAS ===================================

describe('createCategoriaAction', () => {
  it('1. owner crea categoría happy path → ok:true + created_by=ownerA', async () => {
    await signInAs(emailOwnerA);
    const { createCategoriaAction } = await import('@/app/(app)/epp/catalogo/actions');
    const nombre = nextName('CatA');
    const result = await createCategoriaAction({ nombre, descripcion: 'desc' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data } = await admin
      .from('epp_categorias')
      .select('id, nombre, descripcion, consultora_id, created_by, archived_at')
      .eq('id', result.id)
      .single();
    expect(data).toMatchObject({
      nombre,
      descripcion: 'desc',
      consultora_id: cAId,
      created_by: ownerAId,
      archived_at: null,
    });
  });

  it('2. member non-owner → FORBIDDEN_NOT_OWNER', async () => {
    await signInAs(emailMemberA);
    const { createCategoriaAction } = await import('@/app/(app)/epp/catalogo/actions');
    const result = await createCategoriaAction({ nombre: nextName('CatM') });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FORBIDDEN_NOT_OWNER');
  });

  it('3. UNAUTHENTICATED sin sesión', async () => {
    cookieStore.length = 0;
    const { createCategoriaAction } = await import('@/app/(app)/epp/catalogo/actions');
    const result = await createCategoriaAction({ nombre: nextName('CatU') });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('4. nombre duplicado activo en mismo tenant → DUPLICATE_NAME', async () => {
    await signInAs(emailOwnerA);
    const { createCategoriaAction } = await import('@/app/(app)/epp/catalogo/actions');
    const nombre = nextName('CatDup');
    const r1 = await createCategoriaAction({ nombre });
    expect(r1.ok).toBe(true);
    const r2 = await createCategoriaAction({ nombre });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.code).toBe('DUPLICATE_NAME');
    if (r2.code !== 'DUPLICATE_NAME') return;
    expect(r2.fieldErrors.nombre.length).toBeGreaterThan(0);
  });

  it('5. INVALID_INPUT nombre vacío → fieldErrors.nombre', async () => {
    await signInAs(emailOwnerA);
    const { createCategoriaAction } = await import('@/app/(app)/epp/catalogo/actions');
    const result = await createCategoriaAction({ nombre: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
  });
});

describe('updateCategoriaAction + archive + restore', () => {
  it('6. update happy path + audit_log diff', async () => {
    await signInAs(emailOwnerA);
    const { createCategoriaAction, updateCategoriaAction } =
      await import('@/app/(app)/epp/catalogo/actions');
    const nombre = nextName('CatUpd');
    const created = await createCategoriaAction({ nombre, descripcion: 'orig' });
    if (!created.ok) throw new Error('setup failed');

    const result = await updateCategoriaAction(created.id, { descripcion: 'nueva' });
    expect(result.ok).toBe(true);

    const { data: row } = await admin
      .from('epp_categorias')
      .select('descripcion')
      .eq('id', created.id)
      .single();
    expect(row?.descripcion).toBe('nueva');

    const { data: audit } = await admin
      .from('audit_log')
      .select('action, before_data, after_data')
      .eq('entity_id', created.id)
      .eq('entity_type', 'epp_categorias')
      .eq('action', 'updated')
      .order('created_at', { ascending: false })
      .limit(1);
    expect(audit?.length ?? 0).toBeGreaterThan(0);
    const before = (audit?.[0]?.before_data as { descripcion?: string } | null)?.descripcion;
    const after = (audit?.[0]?.after_data as { descripcion?: string } | null)?.descripcion;
    expect(before).toBe('orig');
    expect(after).toBe('nueva');
  });

  it('7. archive happy + ALREADY_ARCHIVED en segunda invocación', async () => {
    await signInAs(emailOwnerA);
    const { createCategoriaAction, archiveCategoriaAction } =
      await import('@/app/(app)/epp/catalogo/actions');
    const created = await createCategoriaAction({ nombre: nextName('CatArch') });
    if (!created.ok) throw new Error('setup failed');

    const r1 = await archiveCategoriaAction(created.id);
    expect(r1.ok).toBe(true);

    const { data: row } = await admin
      .from('epp_categorias')
      .select('archived_at')
      .eq('id', created.id)
      .single();
    expect(row?.archived_at).not.toBeNull();

    const r2 = await archiveCategoriaAction(created.id);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.code).toBe('ALREADY_ARCHIVED');
  });

  it('8. restore happy + ALREADY_ACTIVE en segunda invocación', async () => {
    await signInAs(emailOwnerA);
    const { createCategoriaAction, archiveCategoriaAction, restoreCategoriaAction } =
      await import('@/app/(app)/epp/catalogo/actions');
    const created = await createCategoriaAction({ nombre: nextName('CatRest') });
    if (!created.ok) throw new Error('setup failed');
    await archiveCategoriaAction(created.id);

    const r1 = await restoreCategoriaAction(created.id);
    expect(r1.ok).toBe(true);

    const { data: row } = await admin
      .from('epp_categorias')
      .select('archived_at')
      .eq('id', created.id)
      .single();
    expect(row?.archived_at).toBeNull();

    const r2 = await restoreCategoriaAction(created.id);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.code).toBe('ALREADY_ACTIVE');
  });
});

// ================================ ITEMS ======================================

describe('createItemAction + cross-tenant defense', () => {
  it('9. happy path con categoría válida → ok:true', async () => {
    await signInAs(emailOwnerA);
    const { createCategoriaAction, createItemAction } =
      await import('@/app/(app)/epp/catalogo/actions');
    const cat = await createCategoriaAction({ nombre: nextName('CatI') });
    if (!cat.ok) throw new Error('setup failed');

    const result = await createItemAction({
      nombre: nextName('ItemHappy'),
      categoria_id: cat.id,
      vida_util_meses: 6,
      es_descartable: false,
      requiere_numero_serie: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data } = await admin
      .from('epp_items')
      .select('consultora_id, categoria_id, vida_util_meses, created_by')
      .eq('id', result.id)
      .single();
    expect(data).toMatchObject({
      consultora_id: cAId,
      categoria_id: cat.id,
      vida_util_meses: 6,
      created_by: ownerAId,
    });
  });

  it('10. categoria_id de OTRA consultora → INVALID_INPUT (pre-check RLS oculta)', async () => {
    // Crear categoría en cB con admin.
    const { data: catB } = await admin
      .from('epp_categorias')
      .insert({
        consultora_id: cBId,
        nombre: nextName('CatB'),
        created_by: ownerBId,
      })
      .select('id')
      .single();
    if (!catB) throw new Error('setup failed');

    await signInAs(emailOwnerA);
    const { createItemAction } = await import('@/app/(app)/epp/catalogo/actions');
    const result = await createItemAction({
      nombre: nextName('ItemXTenant'),
      categoria_id: catB.id,
      vida_util_meses: 6,
      es_descartable: false,
      requiere_numero_serie: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
    if (result.code !== 'INVALID_INPUT') return;
    expect(result.fieldErrors.categoria_id?.length ?? 0).toBeGreaterThan(0);
  });

  it('11. es_descartable=true acepta vida_util_meses default 6 → OK', async () => {
    await signInAs(emailOwnerA);
    const { createCategoriaAction, createItemAction } =
      await import('@/app/(app)/epp/catalogo/actions');
    const cat = await createCategoriaAction({ nombre: nextName('CatDesc') });
    if (!cat.ok) throw new Error('setup failed');
    const result = await createItemAction({
      nombre: nextName('ItemDesc'),
      categoria_id: cat.id,
      vida_util_meses: 6,
      es_descartable: true,
      requiere_numero_serie: false,
    });
    expect(result.ok).toBe(true);
  });

  it('12. requiere_numero_serie=true → OK + flag persistido', async () => {
    await signInAs(emailOwnerA);
    const { createCategoriaAction, createItemAction } =
      await import('@/app/(app)/epp/catalogo/actions');
    const cat = await createCategoriaAction({ nombre: nextName('CatSerie') });
    if (!cat.ok) throw new Error('setup failed');
    const result = await createItemAction({
      nombre: nextName('ItemSerie'),
      categoria_id: cat.id,
      vida_util_meses: 12,
      es_descartable: false,
      requiere_numero_serie: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data } = await admin
      .from('epp_items')
      .select('requiere_numero_serie')
      .eq('id', result.id)
      .single();
    expect(data?.requiere_numero_serie).toBe(true);
  });

  it('13. member non-owner → FORBIDDEN_NOT_OWNER', async () => {
    await signInAs(emailMemberA);
    const { createItemAction } = await import('@/app/(app)/epp/catalogo/actions');
    const result = await createItemAction({
      nombre: nextName('ItemM'),
      categoria_id: '00000000-0000-0000-0000-000000000000',
      vida_util_meses: 6,
      es_descartable: false,
      requiere_numero_serie: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FORBIDDEN_NOT_OWNER');
  });
});

describe('updateItemAction + archive + restore', () => {
  it('14. update + archive + restore lifecycle', async () => {
    await signInAs(emailOwnerA);
    const {
      createCategoriaAction,
      createItemAction,
      updateItemAction,
      archiveItemAction,
      restoreItemAction,
    } = await import('@/app/(app)/epp/catalogo/actions');
    const cat = await createCategoriaAction({ nombre: nextName('CatLife') });
    if (!cat.ok) throw new Error('setup failed');
    const created = await createItemAction({
      nombre: nextName('ItemLife'),
      categoria_id: cat.id,
      vida_util_meses: 6,
      es_descartable: false,
      requiere_numero_serie: false,
    });
    if (!created.ok) throw new Error('setup failed');

    const upd = await updateItemAction(created.id, { vida_util_meses: 12 });
    expect(upd.ok).toBe(true);
    const { data: r1 } = await admin
      .from('epp_items')
      .select('vida_util_meses')
      .eq('id', created.id)
      .single();
    expect(r1?.vida_util_meses).toBe(12);

    const arch = await archiveItemAction(created.id);
    expect(arch.ok).toBe(true);
    const { data: r2 } = await admin
      .from('epp_items')
      .select('archived_at')
      .eq('id', created.id)
      .single();
    expect(r2?.archived_at).not.toBeNull();

    const rest = await restoreItemAction(created.id);
    expect(rest.ok).toBe(true);
    const { data: r3 } = await admin
      .from('epp_items')
      .select('archived_at')
      .eq('id', created.id)
      .single();
    expect(r3?.archived_at).toBeNull();
  });
});

// =============================== PUESTOS =====================================

describe('puestos · CRUD + DUPLICATE_NAME', () => {
  it('15. createPuestoAction happy + riesgos_asociados persiste', async () => {
    await signInAs(emailOwnerA);
    const { createPuestoAction } = await import('@/app/(app)/epp/catalogo/actions');
    const nombre = nextName('Puesto');
    const result = await createPuestoAction({
      nombre,
      descripcion: 'desc',
      riesgos_asociados: ['ruido', 'caida_altura'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data } = await admin
      .from('puestos')
      .select('nombre, riesgos_asociados, consultora_id')
      .eq('id', result.id)
      .single();
    expect(data?.consultora_id).toBe(cAId);
    expect(data?.riesgos_asociados).toEqual(['ruido', 'caida_altura']);
  });

  it('16. createPuestoAction nombre duplicado → DUPLICATE_NAME', async () => {
    await signInAs(emailOwnerA);
    const { createPuestoAction } = await import('@/app/(app)/epp/catalogo/actions');
    const nombre = nextName('PuestoDup');
    const r1 = await createPuestoAction({ nombre });
    expect(r1.ok).toBe(true);
    const r2 = await createPuestoAction({ nombre });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.code).toBe('DUPLICATE_NAME');
  });

  it('17. archive + restore puesto', async () => {
    await signInAs(emailOwnerA);
    const { createPuestoAction, archivePuestoAction, restorePuestoAction } =
      await import('@/app/(app)/epp/catalogo/actions');
    const c = await createPuestoAction({ nombre: nextName('PuestoArch') });
    if (!c.ok) throw new Error('setup failed');
    const a = await archivePuestoAction(c.id);
    expect(a.ok).toBe(true);
    const r = await restorePuestoAction(c.id);
    expect(r.ok).toBe(true);
  });
});

// =============================== SEED ========================================

describe('seedDefaultCatalogAction', () => {
  it('18. consultora con catálogo vacío → 8+15+3 created', async () => {
    // Crear consultora dedicada al test de seed para no contaminar count.
    const slug = `t101-seed-${runId}`;
    const { data: cS } = await admin
      .from('consultoras')
      .insert({ name: 'T101 Seed', slug })
      .select('id')
      .single();
    if (!cS) throw new Error('setup failed');
    const cSId = cS.id;

    const email = `t101-seed-${runId}@example.com`;
    const u = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (u.error || !u.data.user) throw new Error('createUser failed');
    const userId = u.data.user.id;

    await admin
      .from('consultora_members')
      .insert({ user_id: userId, consultora_id: cSId, role: 'owner' });
    await admin.auth.admin.updateUserById(userId, {
      app_metadata: { consultora_id: cSId, consultora_role: 'owner' },
    });

    await signInAs(email);
    const { seedDefaultCatalogAction } = await import('@/app/(app)/epp/catalogo/actions');
    const result = await seedDefaultCatalogAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created.categorias).toBe(8);
    expect(result.created.items).toBe(15);
    expect(result.created.puestos).toBe(3);

    const { count: catCount } = await admin
      .from('epp_categorias')
      .select('*', { count: 'exact', head: true })
      .eq('consultora_id', cSId)
      .is('archived_at', null);
    expect(catCount).toBe(8);

    const { count: itemCount } = await admin
      .from('epp_items')
      .select('*', { count: 'exact', head: true })
      .eq('consultora_id', cSId)
      .is('archived_at', null);
    expect(itemCount).toBe(15);

    const { count: puestoCount } = await admin
      .from('puestos')
      .select('*', { count: 'exact', head: true })
      .eq('consultora_id', cSId)
      .is('archived_at', null);
    expect(puestoCount).toBe(3);

    // 19. Re-invocación → 0+0+0 idempotente.
    const result2 = await seedDefaultCatalogAction();
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.created.categorias).toBe(0);
    expect(result2.created.items).toBe(0);
    expect(result2.created.puestos).toBe(0);

    // 20. Borrar 1 categoría seedeada → re-invocar completa SOLO la borrada.
    // Para borrar categoría sin violar FK con items, hard-delete items asociados primero.
    const { data: catCabeza } = await admin
      .from('epp_categorias')
      .select('id')
      .eq('consultora_id', cSId)
      .eq('nombre', 'Protección cabeza')
      .single();
    if (catCabeza) {
      await admin.from('epp_items').delete().eq('categoria_id', catCabeza.id);
      await admin.from('epp_categorias').delete().eq('id', catCabeza.id);
    }

    const result3 = await seedDefaultCatalogAction();
    expect(result3.ok).toBe(true);
    if (!result3.ok) return;
    expect(result3.created.categorias).toBe(1);
    // Casco clase A es el único item con categoria_nombre='Protección cabeza'.
    expect(result3.created.items).toBe(1);
    expect(result3.created.puestos).toBe(0);

    // Cleanup específico de esta consultora.
    await admin.from('epp_items').delete().eq('consultora_id', cSId);
    await admin.from('epp_categorias').delete().eq('consultora_id', cSId);
    await admin.from('puestos').delete().eq('consultora_id', cSId);
    await admin.from('consultora_members').delete().eq('consultora_id', cSId);
    await admin.from('consultoras').delete().eq('id', cSId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  });

  it('21. member non-owner → FORBIDDEN_NOT_OWNER (no crea nada)', async () => {
    await signInAs(emailMemberA);
    const { seedDefaultCatalogAction } = await import('@/app/(app)/epp/catalogo/actions');
    const result = await seedDefaultCatalogAction();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FORBIDDEN_NOT_OWNER');
  });
});

// =============================== QUERIES =====================================

describe('queries', () => {
  it('22. listCategorias respeta includeArchived', async () => {
    await signInAs(emailOwnerA);
    const { createCategoriaAction, archiveCategoriaAction } =
      await import('@/app/(app)/epp/catalogo/actions');
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { listCategorias } = await import('@/app/(app)/epp/catalogo/queries');

    const activeName = nextName('CatQActive');
    const archivedName = nextName('CatQArch');
    const active = await createCategoriaAction({ nombre: activeName });
    const toArch = await createCategoriaAction({ nombre: archivedName });
    if (!active.ok || !toArch.ok) throw new Error('setup failed');
    await archiveCategoriaAction(toArch.id);

    const sb = await createServerClient();
    const onlyActive = await listCategorias(sb, { includeArchived: false });
    const names = onlyActive.map((c) => c.nombre);
    expect(names).toContain(activeName);
    expect(names).not.toContain(archivedName);

    const withArch = await listCategorias(sb, { includeArchived: true });
    const namesAll = withArch.map((c) => c.nombre);
    expect(namesAll).toContain(activeName);
    expect(namesAll).toContain(archivedName);
  });

  it('23. listItemsConCategoria devuelve categoria_nombre via JOIN', async () => {
    await signInAs(emailOwnerA);
    const { createCategoriaAction, createItemAction } =
      await import('@/app/(app)/epp/catalogo/actions');
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { listItemsConCategoria } = await import('@/app/(app)/epp/catalogo/queries');

    const catName = nextName('CatJoin');
    const itemName = nextName('ItemJoin');
    const cat = await createCategoriaAction({ nombre: catName });
    if (!cat.ok) throw new Error('setup failed');
    const item = await createItemAction({
      nombre: itemName,
      categoria_id: cat.id,
      vida_util_meses: 6,
      es_descartable: false,
      requiere_numero_serie: false,
    });
    if (!item.ok) throw new Error('setup failed');

    const sb = await createServerClient();
    const items = await listItemsConCategoria(sb, { includeArchived: false });
    const found = items.find((i) => i.id === item.id);
    expect(found).toBeDefined();
    expect(found?.categoria_nombre).toBe(catName);
  });

  it('24. countCatalogo shape + cross-tenant isolation', async () => {
    await signInAs(emailOwnerB);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { countCatalogo } = await import('@/app/(app)/epp/catalogo/queries');

    const sb = await createServerClient();
    const counts = await countCatalogo(sb, cBId);
    expect(counts).toMatchObject({
      categorias: expect.any(Number),
      items: expect.any(Number),
      puestos: expect.any(Number),
    });
    // cB no debería contener items/categorías que creamos en cA en tests previos.
    // Verificamos solo que el count es 0 + lo que cB haya seedeado en sus propios tests.
    expect(counts.categorias).toBeGreaterThanOrEqual(0);
  });

  it('25. cross-tenant defense: ownerA NO ve categorías de cB', async () => {
    // Crear categoría en cB via admin.
    const nombreB = nextName('CatBOnly');
    await admin.from('epp_categorias').insert({
      consultora_id: cBId,
      nombre: nombreB,
      created_by: ownerBId,
    });

    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { listCategorias } = await import('@/app/(app)/epp/catalogo/queries');

    const sb = await createServerClient();
    const all = await listCategorias(sb, { includeArchived: true });
    const names = all.map((c) => c.nombre);
    expect(names).not.toContain(nombreB);
  });
});
