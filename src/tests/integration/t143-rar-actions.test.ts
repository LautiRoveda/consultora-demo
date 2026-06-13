/**
 * T-143 · Integration server actions del módulo RAR (catálogo + exposición).
 *
 * Cobertura:
 *  - createAgenteAction: owner happy (created_by) + member FORBIDDEN +
 *    UNAUTHENTICATED + DUPLICATE (codigo y nombre) + INVALID_INPUT.
 *  - archiveAgenteAction + restoreAgenteAction (+ ALREADY_*).
 *  - seedDefaultCatalogAction: consultora vacía → AGENTES_658_DEFAULT.length;
 *    re-invocación → 0 (idempotente); member → FORBIDDEN.
 *  - assignAgenteAPuestoAction (member-level): happy + idempotente (2ª → ok) +
 *    CLIENTE_NOT_FOUND + PUESTO_NOT_FOUND + AGENTE_NOT_FOUND (cross-tenant).
 *  - removeAgenteDePuestoAction: happy + NOT_FOUND (segunda invocación).
 *
 * Harness server-action: mock next/headers cookies + server-only + next/cache +
 * logger; `signInAs` puebla el cookieStore vía el server client real. Molde
 * epp-catalogo-actions.test.ts. Setup secuencial (lesson T-047).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENTES_658_DEFAULT } from '@/app/(app)/rar/catalogo-data';

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

const slugA = `t143a-${runId}`;
const slugB = `t143b-${runId}`;
const slugSeed = `t143seed-${runId}`;
const emailOwnerA = `t143a-own-${runId}@example.com`;
const emailMemberA = `t143a-mem-${runId}@example.com`;
const emailOwnerB = `t143b-own-${runId}@example.com`;
const emailOwnerSeed = `t143seed-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let cSeedId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let ownerSeedId: string;

// Fixtures para exposición (via admin).
let puestoAId: string;
let agenteAId: string;
let puestoBId: string;
let agenteBId: string;
let clienteAId: string;
let clienteBId: string;

let codigoCounter = 0;
function nextCodigo(): string {
  codigoCounter += 1;
  return `RA-${runId}-${codigoCounter}`;
}

async function mkConsultora(name: string, slug: string): Promise<string> {
  const { data, error } = await admin
    .from('consultoras')
    .insert({ name, slug })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insert consultora ${slug}: ${JSON.stringify(error)}`);
  return data.id;
}

async function mkUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${JSON.stringify(error)}`);
  return data.user.id;
}

beforeAll(async () => {
  cAId = await mkConsultora('T143A', slugA);
  cBId = await mkConsultora('T143B', slugB);
  cSeedId = await mkConsultora('T143Seed', slugSeed);

  ownerAId = await mkUser(emailOwnerA);
  memberAId = await mkUser(emailMemberA);
  ownerBId = await mkUser(emailOwnerB);
  ownerSeedId = await mkUser(emailOwnerSeed);

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
    { user_id: ownerSeedId, consultora_id: cSeedId, role: 'owner' },
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
  await admin.auth.admin.updateUserById(ownerSeedId, {
    app_metadata: { consultora_id: cSeedId, consultora_role: 'owner' },
  });

  // Fixtures de exposición.
  const pA = await admin
    .from('puestos')
    .insert({ consultora_id: cAId, nombre: `Soldador ${runId}` })
    .select('id')
    .single();
  puestoAId = pA.data!.id;
  const pB = await admin
    .from('puestos')
    .insert({ consultora_id: cBId, nombre: `Gruista ${runId}` })
    .select('id')
    .single();
  puestoBId = pB.data!.id;
  const aA = await admin
    .from('rar_agentes')
    .insert({
      consultora_id: cAId,
      codigo: `FX-A-${runId}`,
      nombre: `Ruido A ${runId}`,
      agente_tipo: 'fisico',
    })
    .select('id')
    .single();
  agenteAId = aA.data!.id;
  const aB = await admin
    .from('rar_agentes')
    .insert({
      consultora_id: cBId,
      codigo: `FX-B-${runId}`,
      nombre: `Ruido B ${runId}`,
      agente_tipo: 'fisico',
    })
    .select('id')
    .single();
  agenteBId = aB.data!.id;

  // Clientes/establecimientos (T-145: la exposición es cliente×puesto×agente).
  const cuitA = Date.now().toString().slice(-8).padStart(8, '0');
  const clA = await admin
    .from('clientes')
    .insert({ consultora_id: cAId, razon_social: `Cliente A ${runId}`, cuit: `30-${cuitA}-5` })
    .select('id')
    .single();
  clienteAId = clA.data!.id;
  const cuitB = (Date.now() + 1).toString().slice(-8).padStart(8, '0');
  const clB = await admin
    .from('clientes')
    .insert({ consultora_id: cBId, razon_social: `Cliente B ${runId}`, cuit: `30-${cuitB}-6` })
    .select('id')
    .single();
  clienteBId = clB.data!.id;
});

afterAll(async () => {
  const ids = [cAId, cBId, cSeedId];
  await admin
    .from('cliente_puesto_agentes')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('rar_agentes')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('puestos')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('clientes')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('consultora_members')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('consultoras')
    .delete()
    .in('id', ids)
    .then(() => {});
  for (const u of [ownerAId, memberAId, ownerBId, ownerSeedId]) {
    await admin.auth.admin.deleteUser(u).catch(() => {});
  }
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

// ============================== CATÁLOGO ===================================

describe('createAgenteAction', () => {
  it('owner crea agente happy → ok + created_by/consultora', async () => {
    await signInAs(emailOwnerA);
    const { createAgenteAction } = await import('@/app/(app)/rar/actions');
    const codigo = nextCodigo();
    const result = await createAgenteAction({
      codigo,
      nombre: `Agente ${codigo}`,
      agente_tipo: 'quimico',
      cas: '71-43-2',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data } = await admin
      .from('rar_agentes')
      .select('codigo, agente_tipo, cas, consultora_id, created_by, archived_at')
      .eq('id', result.id)
      .single();
    expect(data).toMatchObject({
      codigo,
      agente_tipo: 'quimico',
      cas: '71-43-2',
      consultora_id: cAId,
      created_by: ownerAId,
      archived_at: null,
    });
  });

  it('member non-owner → FORBIDDEN_NOT_OWNER', async () => {
    await signInAs(emailMemberA);
    const { createAgenteAction } = await import('@/app/(app)/rar/actions');
    const result = await createAgenteAction({
      codigo: nextCodigo(),
      nombre: 'X member',
      agente_tipo: 'fisico',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FORBIDDEN_NOT_OWNER');
  });

  it('sin sesión → UNAUTHENTICATED', async () => {
    cookieStore.length = 0;
    const { createAgenteAction } = await import('@/app/(app)/rar/actions');
    const result = await createAgenteAction({
      codigo: nextCodigo(),
      nombre: 'X anon',
      agente_tipo: 'fisico',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('codigo duplicado activo → DUPLICATE (fieldErrors.codigo)', async () => {
    await signInAs(emailOwnerA);
    const { createAgenteAction } = await import('@/app/(app)/rar/actions');
    const codigo = nextCodigo();
    const r1 = await createAgenteAction({
      codigo,
      nombre: `Dup codigo A ${codigo}`,
      agente_tipo: 'fisico',
    });
    expect(r1.ok).toBe(true);
    const r2 = await createAgenteAction({
      codigo,
      nombre: `Dup codigo B ${codigo}`,
      agente_tipo: 'fisico',
    });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.code).toBe('DUPLICATE');
    if (r2.code !== 'DUPLICATE') return;
    expect(r2.fieldErrors.codigo?.length ?? 0).toBeGreaterThan(0);
  });

  it('nombre duplicado activo → DUPLICATE (fieldErrors.nombre)', async () => {
    await signInAs(emailOwnerA);
    const { createAgenteAction } = await import('@/app/(app)/rar/actions');
    const nombre = `Nombre dup ${nextCodigo()}`;
    const r1 = await createAgenteAction({ codigo: nextCodigo(), nombre, agente_tipo: 'fisico' });
    expect(r1.ok).toBe(true);
    const r2 = await createAgenteAction({ codigo: nextCodigo(), nombre, agente_tipo: 'fisico' });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.code).toBe('DUPLICATE');
    if (r2.code !== 'DUPLICATE') return;
    expect(r2.fieldErrors.nombre?.length ?? 0).toBeGreaterThan(0);
  });

  it('codigo vacío → INVALID_INPUT', async () => {
    await signInAs(emailOwnerA);
    const { createAgenteAction } = await import('@/app/(app)/rar/actions');
    const result = await createAgenteAction({ codigo: '', nombre: 'X', agente_tipo: 'fisico' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
  });
});

describe('archiveAgenteAction + restoreAgenteAction', () => {
  it('archive happy + ALREADY_ARCHIVED en 2ª; restore happy + ALREADY_ACTIVE', async () => {
    await signInAs(emailOwnerA);
    const { createAgenteAction, archiveAgenteAction, restoreAgenteAction } =
      await import('@/app/(app)/rar/actions');
    const created = await createAgenteAction({
      codigo: nextCodigo(),
      nombre: `Arch ${nextCodigo()}`,
      agente_tipo: 'fisico',
    });
    if (!created.ok) throw new Error('setup failed');

    const a1 = await archiveAgenteAction(created.id);
    expect(a1.ok).toBe(true);
    const a2 = await archiveAgenteAction(created.id);
    expect(a2.ok).toBe(false);
    if (!a2.ok) expect(a2.code).toBe('ALREADY_ARCHIVED');

    const r1 = await restoreAgenteAction(created.id);
    expect(r1.ok).toBe(true);
    const r2 = await restoreAgenteAction(created.id);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('ALREADY_ACTIVE');
  });
});

describe('seedDefaultCatalogAction', () => {
  it('consultora vacía → siembra AGENTES_658_DEFAULT.length; re-invocar → 0 (idempotente)', async () => {
    await signInAs(emailOwnerSeed);
    const { seedDefaultCatalogAction } = await import('@/app/(app)/rar/actions');

    const r1 = await seedDefaultCatalogAction();
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.created.agentes).toBe(AGENTES_658_DEFAULT.length);

    const r2 = await seedDefaultCatalogAction();
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.created.agentes).toBe(0);

    // No hay duplicados activos por codigo.
    const { data } = await admin
      .from('rar_agentes')
      .select('codigo')
      .eq('consultora_id', cSeedId)
      .is('archived_at', null);
    const codigos = (data ?? []).map((a) => a.codigo);
    expect(codigos.length).toBe(AGENTES_658_DEFAULT.length);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('member non-owner → FORBIDDEN_NOT_OWNER', async () => {
    await signInAs(emailMemberA);
    const { seedDefaultCatalogAction } = await import('@/app/(app)/rar/actions');
    const result = await seedDefaultCatalogAction();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FORBIDDEN_NOT_OWNER');
  });
});

// ============================== EXPOSICIÓN ===================================

describe('assignAgenteAPuestoAction + removeAgenteDePuestoAction', () => {
  it('asigna agente a puesto (member-level) happy + idempotente; quita + NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { assignAgenteAPuestoAction, removeAgenteDePuestoAction } =
      await import('@/app/(app)/rar/actions');

    const a1 = await assignAgenteAPuestoAction({
      cliente_id: clienteAId,
      puesto_id: puestoAId,
      agente_id: agenteAId,
    });
    expect(a1.ok).toBe(true);
    const { data: row } = await admin
      .from('cliente_puesto_agentes')
      .select('consultora_id, asignado_por')
      .eq('cliente_id', clienteAId)
      .eq('puesto_id', puestoAId)
      .eq('agente_id', agenteAId)
      .single();
    expect(row).toMatchObject({ consultora_id: cAId, asignado_por: ownerAId });

    // Idempotente: 2ª asignación → ok silencioso.
    const a2 = await assignAgenteAPuestoAction({
      cliente_id: clienteAId,
      puesto_id: puestoAId,
      agente_id: agenteAId,
    });
    expect(a2.ok).toBe(true);

    const d1 = await removeAgenteDePuestoAction({
      cliente_id: clienteAId,
      puesto_id: puestoAId,
      agente_id: agenteAId,
    });
    expect(d1.ok).toBe(true);
    const d2 = await removeAgenteDePuestoAction({
      cliente_id: clienteAId,
      puesto_id: puestoAId,
      agente_id: agenteAId,
    });
    expect(d2.ok).toBe(false);
    if (!d2.ok) expect(d2.code).toBe('NOT_FOUND');
  });

  it('cross-tenant: cliente de otra consultora → CLIENTE_NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { assignAgenteAPuestoAction } = await import('@/app/(app)/rar/actions');
    const result = await assignAgenteAPuestoAction({
      cliente_id: clienteBId,
      puesto_id: puestoAId,
      agente_id: agenteAId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CLIENTE_NOT_FOUND');
  });

  it('cross-tenant: puesto de otra consultora → PUESTO_NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { assignAgenteAPuestoAction } = await import('@/app/(app)/rar/actions');
    const result = await assignAgenteAPuestoAction({
      cliente_id: clienteAId,
      puesto_id: puestoBId,
      agente_id: agenteAId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PUESTO_NOT_FOUND');
  });

  it('cross-tenant: agente de otra consultora → AGENTE_NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { assignAgenteAPuestoAction } = await import('@/app/(app)/rar/actions');
    const result = await assignAgenteAPuestoAction({
      cliente_id: clienteAId,
      puesto_id: puestoAId,
      agente_id: agenteBId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AGENTE_NOT_FOUND');
  });
});
