/**
 * T-048 · Tests de integration de las server actions + queries del módulo
 * Clientes.
 *
 * Cobertura:
 *  - createClienteAction: happy path member + CUIT normalizado pre-DB +
 *    INVALID_INPUT + UNAUTHENTICATED + NO_CONSULTORA + DUPLICATE_CUIT con
 *    reactivación post-archive.
 *  - updateClienteAction: happy patch parcial + audit_log diff + NOT_FOUND +
 *    cross-tenant NOT_FOUND (RLS filtra el SELECT defensivo) + DUPLICATE_CUIT
 *    al cambiar CUIT a uno colisionante.
 *  - archive/unarchive: archive happy + ALREADY_ARCHIVED + unarchive happy +
 *    ALREADY_ACTIVE.
 *  - queries: getClientesForConsultora con/sin includeArchived + getClienteById
 *    cross-tenant null + searchClientesByRazonSocial (case-insensitive +
 *    min 2 chars + archived excluded + wildcards safe).
 *
 * Setup SECUENCIAL (lesson T-047 — Promise.all sa-east-1 flaky).
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

const slugA = `t048a-${runId}`;
const slugB = `t048b-${runId}`;
const emailOwnerA = `t048a-own-${runId}@example.com`;
const emailMemberA = `t048a-mem-${runId}@example.com`;
const emailOwnerB = `t048b-own-${runId}@example.com`;
const emailNoConsul = `t048-nocon-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let noConsulId: string;

beforeAll(async () => {
  // Setup SECUENCIAL — lesson T-047 (Promise.all flaky sa-east-1).
  const { data: cA, error: errCA } = await admin
    .from('consultoras')
    .insert({ name: 'T048A', slug: slugA })
    .select('id')
    .single();
  expect(errCA).toBeNull();
  cAId = cA!.id;

  const { data: cB, error: errCB } = await admin
    .from('consultoras')
    .insert({ name: 'T048B', slug: slugB })
    .select('id')
    .single();
  expect(errCB).toBeNull();
  cBId = cB!.id;

  const { data: uOA, error: errUOA } = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  expect(errUOA).toBeNull();
  ownerAId = uOA.user!.id;

  const { data: uMA, error: errUMA } = await admin.auth.admin.createUser({
    email: emailMemberA,
    password,
    email_confirm: true,
  });
  expect(errUMA).toBeNull();
  memberAId = uMA.user!.id;

  const { data: uOB, error: errUOB } = await admin.auth.admin.createUser({
    email: emailOwnerB,
    password,
    email_confirm: true,
  });
  expect(errUOB).toBeNull();
  ownerBId = uOB.user!.id;

  const { data: uNc, error: errUNc } = await admin.auth.admin.createUser({
    email: emailNoConsul,
    password,
    email_confirm: true,
  });
  expect(errUNc).toBeNull();
  noConsulId = uNc.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(memberAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
  await admin.auth.admin.deleteUser(noConsulId).catch(() => {});
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

// Helper: generar CUITs únicos por test para evitar colisiones cross-test
// dentro de la misma consultora (UNIQUE partial WHERE archived_at IS NULL).
// Formato XX-XXXXXXXX-X. Los primeros 2 dígitos viables: 20/23/24/27/30/33/34.
let cuitCounter = 10000000;
function nextCuit(): string {
  cuitCounter += 1;
  const middle = cuitCounter.toString().padStart(8, '0');
  return `30-${middle}-9`;
}

describe('createClienteAction', () => {
  it('1. member non-owner crea cliente con CUIT XX-XXXXXXXX-X → ok:true + created_by=memberAId', async () => {
    await signInAs(emailMemberA);
    const { createClienteAction } = await import('@/app/(app)/clientes/actions');
    const cuit = nextCuit();
    const result = await createClienteAction({
      razon_social: 'Acme SA',
      cuit,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: cliente } = await admin
      .from('clientes')
      .select('id, razon_social, cuit, created_by, consultora_id, archived_at')
      .eq('id', result.clienteId)
      .single();
    expect(cliente).toMatchObject({
      razon_social: 'Acme SA',
      cuit,
      created_by: memberAId,
      consultora_id: cAId,
      archived_at: null,
    });
  });

  it('2. CUIT sin guiones 30XXXXXXXXX9 → normaliza a 30-XXXXXXXX-9 pre-DB', async () => {
    await signInAs(emailOwnerA);
    const { createClienteAction } = await import('@/app/(app)/clientes/actions');
    const cuit = nextCuit(); // 30-XXXXXXXX-9
    const cuitUnformatted = cuit.replace(/-/g, '');
    const result = await createClienteAction({
      razon_social: 'Beta Industrial SRL',
      cuit: cuitUnformatted,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: cliente } = await admin
      .from('clientes')
      .select('cuit')
      .eq('id', result.clienteId)
      .single();
    expect(cliente?.cuit).toBe(cuit); // Normalizado, NO igual al input.
  });

  it('3. INVALID_INPUT razón_social vacía → fieldErrors.razon_social', async () => {
    await signInAs(emailOwnerA);
    const { createClienteAction } = await import('@/app/(app)/clientes/actions');
    const result = await createClienteAction({
      razon_social: '',
      cuit: nextCuit(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
    if (result.code !== 'INVALID_INPUT') return;
    expect(result.fieldErrors.razon_social?.length ?? 0).toBeGreaterThan(0);
  });

  it('4. UNAUTHENTICATED sin sesión', async () => {
    cookieStore.length = 0; // sin signIn
    const { createClienteAction } = await import('@/app/(app)/clientes/actions');
    const result = await createClienteAction({
      razon_social: 'No Auth SA',
      cuit: nextCuit(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('5. NO_CONSULTORA user huérfano', async () => {
    await signInAs(emailNoConsul);
    const { createClienteAction } = await import('@/app/(app)/clientes/actions');
    const result = await createClienteAction({
      razon_social: 'No Consul SA',
      cuit: nextCuit(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_CONSULTORA');
  });

  it('6. DUPLICATE_CUIT same tenant + same CUIT activo → DUPLICATE_CUIT; archivar primero permite reactivar', async () => {
    await signInAs(emailOwnerA);
    const { createClienteAction } = await import('@/app/(app)/clientes/actions');
    const cuit = nextCuit();

    // (a) primer INSERT OK.
    const r1 = await createClienteAction({ razon_social: 'Duplicate Test 1', cuit });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const firstId = r1.clienteId;

    // (b) segundo INSERT mismo CUIT, mismo tenant → DUPLICATE_CUIT.
    const r2 = await createClienteAction({ razon_social: 'Duplicate Test 2', cuit });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.code).toBe('DUPLICATE_CUIT');
    if (r2.code !== 'DUPLICATE_CUIT') return;
    expect(r2.fieldErrors.cuit.length).toBeGreaterThan(0);

    // (c) archivar el primero via admin (acción dedicada en otro test).
    await admin
      .from('clientes')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', firstId);

    // (d) tercer INSERT con MISMO CUIT → ok:true (UNIQUE partial permite tras archive).
    const r3 = await createClienteAction({ razon_social: 'Duplicate Test 3', cuit });
    expect(r3.ok).toBe(true);
  });
});

describe('updateClienteAction', () => {
  it('7. happy path patch parcial razon_social → audit_log diff before/after', async () => {
    await signInAs(emailMemberA);
    const { createClienteAction, updateClienteAction } =
      await import('@/app/(app)/clientes/actions');
    const created = await createClienteAction({
      razon_social: 'Original Name SRL',
      cuit: nextCuit(),
      industria: 'metalurgica',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateClienteAction(created.clienteId, {
      razon_social: 'Renamed SRL',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: cliente } = await admin
      .from('clientes')
      .select('razon_social, industria')
      .eq('id', created.clienteId)
      .single();
    expect(cliente).toMatchObject({
      razon_social: 'Renamed SRL',
      industria: 'metalurgica', // intacto, no estaba en el patch
    });

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, before_data, after_data')
      .eq('entity_id', created.clienteId)
      .eq('entity_type', 'clientes')
      .eq('action', 'updated')
      .order('created_at', { ascending: false });
    expect(auditRows?.length ?? 0).toBeGreaterThan(0);
    const latest = auditRows?.[0];
    expect(latest).toBeDefined();
    if (!latest) return;
    const beforeRazon = (latest.before_data as { razon_social?: string } | null)?.razon_social;
    const afterRazon = (latest.after_data as { razon_social?: string } | null)?.razon_social;
    expect(beforeRazon).toBe('Original Name SRL');
    expect(afterRazon).toBe('Renamed SRL');
  });

  it('8. NOT_FOUND con UUID inexistente', async () => {
    await signInAs(emailOwnerA);
    const { updateClienteAction } = await import('@/app/(app)/clientes/actions');
    const result = await updateClienteAction('00000000-0000-0000-0000-000000000000', {
      razon_social: 'Whatever SA',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('9. Cross-tenant NOT_FOUND: member cA intenta UPDATE cliente de cB', async () => {
    // Crear cliente en cB via admin (no usamos action porque queremos created_by=ownerBId).
    const { data: clienteB } = await admin
      .from('clientes')
      .insert({
        consultora_id: cBId,
        razon_social: 'Beta Tenant Cliente',
        cuit: nextCuit(),
        created_by: ownerBId,
      })
      .select('id')
      .single();

    await signInAs(emailMemberA);
    const { updateClienteAction } = await import('@/app/(app)/clientes/actions');
    const result = await updateClienteAction(clienteB!.id, {
      razon_social: 'Hacked Name',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');

    // Defensive: cliente real intacto.
    const { data: realCliente } = await admin
      .from('clientes')
      .select('razon_social')
      .eq('id', clienteB!.id)
      .single();
    expect(realCliente?.razon_social).toBe('Beta Tenant Cliente');
  });

  it('10. DUPLICATE_CUIT al cambiar CUIT a uno que ya existe en tenant', async () => {
    await signInAs(emailOwnerA);
    const { createClienteAction, updateClienteAction } =
      await import('@/app/(app)/clientes/actions');
    const cuit1 = nextCuit();
    const cuit2 = nextCuit();

    const c1 = await createClienteAction({ razon_social: 'C1', cuit: cuit1 });
    const c2 = await createClienteAction({ razon_social: 'C2', cuit: cuit2 });
    expect(c1.ok).toBe(true);
    expect(c2.ok).toBe(true);
    if (!c2.ok) return;

    // c2 intenta tomar el CUIT de c1.
    const result = await updateClienteAction(c2.clienteId, { cuit: cuit1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DUPLICATE_CUIT');
    if (result.code !== 'DUPLICATE_CUIT') return;
    expect(result.fieldErrors.cuit.length).toBeGreaterThan(0);
  });
});

describe('archive/unarchive', () => {
  it('11. archive happy path → archived_at IS NOT NULL', async () => {
    await signInAs(emailOwnerA);
    const { createClienteAction, archiveClienteAction } =
      await import('@/app/(app)/clientes/actions');
    const created = await createClienteAction({
      razon_social: 'To Archive SA',
      cuit: nextCuit(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const beforeMs = Date.now();
    const result = await archiveClienteAction(created.clienteId);
    const afterMs = Date.now();
    expect(result.ok).toBe(true);

    const { data: cliente } = await admin
      .from('clientes')
      .select('archived_at')
      .eq('id', created.clienteId)
      .single();
    expect(cliente?.archived_at).not.toBeNull();
    const archivedMs = new Date(cliente!.archived_at!).getTime();
    expect(archivedMs).toBeGreaterThanOrEqual(beforeMs - 1000);
    expect(archivedMs).toBeLessThanOrEqual(afterMs + 1000);
  });

  it('12. archive de ya-archivado → ALREADY_ARCHIVED', async () => {
    await signInAs(emailOwnerA);
    const { createClienteAction, archiveClienteAction } =
      await import('@/app/(app)/clientes/actions');
    const created = await createClienteAction({
      razon_social: 'Pre Archived SA',
      cuit: nextCuit(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Archivar via admin para no contaminar archive happy.
    await admin
      .from('clientes')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', created.clienteId);

    const result = await archiveClienteAction(created.clienteId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ALREADY_ARCHIVED');
  });

  it('13. unarchive happy + unarchive de activo → ALREADY_ACTIVE', async () => {
    await signInAs(emailOwnerA);
    const { createClienteAction, archiveClienteAction, unarchiveClienteAction } =
      await import('@/app/(app)/clientes/actions');
    const created = await createClienteAction({
      razon_social: 'Unarchive Test SA',
      cuit: nextCuit(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // (a) archive + unarchive happy → archived_at vuelve a null.
    const arch = await archiveClienteAction(created.clienteId);
    expect(arch.ok).toBe(true);

    const unarch = await unarchiveClienteAction(created.clienteId);
    expect(unarch.ok).toBe(true);

    const { data: cliente } = await admin
      .from('clientes')
      .select('archived_at')
      .eq('id', created.clienteId)
      .single();
    expect(cliente?.archived_at).toBeNull();

    // (b) unarchive de activo → ALREADY_ACTIVE.
    const unarch2 = await unarchiveClienteAction(created.clienteId);
    expect(unarch2.ok).toBe(false);
    if (unarch2.ok) return;
    expect(unarch2.code).toBe('ALREADY_ACTIVE');
  });
});

describe('queries', () => {
  it('14. getClientesForConsultora default → solo activos ordenados alfa', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { getClientesForConsultora } = await import('@/app/(app)/clientes/queries');

    // Crear 3 activos con razones sociales ordenables + 1 archivado.
    // Prefijos únicos por test (T14-) para no chocar con clientes de otros tests.
    const prefix = `T14-${runId}-`;
    const cuit1 = nextCuit();
    const cuit2 = nextCuit();
    const cuit3 = nextCuit();
    const cuit4 = nextCuit();

    await admin.from('clientes').insert([
      { consultora_id: cAId, razon_social: `${prefix}Acme`, cuit: cuit1, created_by: ownerAId },
      { consultora_id: cAId, razon_social: `${prefix}Beta`, cuit: cuit2, created_by: ownerAId },
      { consultora_id: cAId, razon_social: `${prefix}Charlie`, cuit: cuit3, created_by: ownerAId },
      {
        consultora_id: cAId,
        razon_social: `${prefix}Zulu`,
        cuit: cuit4,
        created_by: ownerAId,
        archived_at: new Date().toISOString(),
      },
    ]);

    const sb = await createServerClient();
    const all = await getClientesForConsultora(sb, { limit: 200 });
    const filtered = all.filter((c) => c.razon_social.startsWith(prefix));
    expect(filtered.map((c) => c.razon_social)).toEqual([
      `${prefix}Acme`,
      `${prefix}Beta`,
      `${prefix}Charlie`,
    ]);
    expect(filtered.every((c) => c.archived_at === null)).toBe(true);
  });

  it('15. getClientesForConsultora con includeArchived:true → incluye archivados', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { getClientesForConsultora } = await import('@/app/(app)/clientes/queries');

    const prefix = `T15-${runId}-`;
    await admin.from('clientes').insert([
      {
        consultora_id: cAId,
        razon_social: `${prefix}Active1`,
        cuit: nextCuit(),
        created_by: ownerAId,
      },
      {
        consultora_id: cAId,
        razon_social: `${prefix}Archived1`,
        cuit: nextCuit(),
        created_by: ownerAId,
        archived_at: new Date().toISOString(),
      },
    ]);

    const sb = await createServerClient();
    const all = await getClientesForConsultora(sb, { includeArchived: true, limit: 200 });
    const filtered = all.filter((c) => c.razon_social.startsWith(prefix));
    expect(filtered.length).toBe(2);
    expect(filtered.some((c) => c.archived_at !== null)).toBe(true);
  });

  it('16. getClienteById cross-tenant → null', async () => {
    // Cliente en cB.
    const { data: clienteB } = await admin
      .from('clientes')
      .insert({
        consultora_id: cBId,
        razon_social: 'Cross Tenant Defense',
        cuit: nextCuit(),
        created_by: ownerBId,
      })
      .select('id')
      .single();

    await signInAs(emailMemberA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { getClienteById } = await import('@/app/(app)/clientes/queries');
    const sb = await createServerClient();
    const result = await getClienteById(sb, clienteB!.id);
    expect(result).toBeNull();
  });

  it('17. searchClientesByRazonSocial: ILIKE case-insensitive + min 2 chars + archived excluded + wildcards safe', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { searchClientesByRazonSocial } = await import('@/app/(app)/clientes/queries');

    const prefix = `T17-${runId}-`;
    await admin.from('clientes').insert([
      {
        consultora_id: cAId,
        razon_social: `${prefix}ACME Industrial SRL`,
        cuit: nextCuit(),
        created_by: ownerAId,
      },
      {
        consultora_id: cAId,
        razon_social: `${prefix}Acmesa`,
        cuit: nextCuit(),
        created_by: ownerAId,
      },
      {
        consultora_id: cAId,
        razon_social: `${prefix}Beta SA`,
        cuit: nextCuit(),
        created_by: ownerAId,
      },
      {
        consultora_id: cAId,
        razon_social: `${prefix}ACME Old`,
        cuit: nextCuit(),
        created_by: ownerAId,
        archived_at: new Date().toISOString(),
      },
    ]);

    const sb = await createServerClient();

    // (a) case-insensitive — buscar 'acme' matchea 'ACME Industrial' y 'Acmesa'.
    const rA = await searchClientesByRazonSocial(sb, `${prefix}acme`);
    const namesA = rA.map((c) => c.razon_social).sort();
    expect(namesA).toEqual([`${prefix}ACME Industrial SRL`, `${prefix}Acmesa`]);

    // (b) min 2 chars: 'a' devuelve [].
    const rB = await searchClientesByRazonSocial(sb, 'a');
    expect(rB).toEqual([]);

    // (c) no matches → [].
    const rC = await searchClientesByRazonSocial(sb, 'xyz123nonexistent');
    expect(rC).toEqual([]);

    // (d) archivado NO aparece — query mayúscula matchearía ambos activos + archivado;
    // verificamos que 'ACME Old' (archivado) NO está, pero los 2 activos sí.
    const rD = await searchClientesByRazonSocial(sb, `${prefix}ACME`);
    const namesD = rD.map((c) => c.razon_social).sort();
    expect(namesD).toContain(`${prefix}ACME Industrial SRL`);
    expect(namesD).not.toContain(`${prefix}ACME Old`);

    // (e) wildcards safe: '%' literal en input no rompe ni matchea como wildcard.
    // Buscar '%' literal con escape → length 0 (no hay cliente con '%' en razón social).
    const rE = await searchClientesByRazonSocial(sb, '%%');
    expect(rE).toEqual([]);
  });
});
