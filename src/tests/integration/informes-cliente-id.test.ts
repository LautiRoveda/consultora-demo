/**
 * T-050 · Tests de integration de la integración Clientes ↔ Informes.
 *
 * Cobertura:
 *  - createInformeAction: persiste cliente_id válido del propio tenant +
 *    rechaza cliente_id cross-tenant con INVALID_INPUT (defense pre-INSERT) +
 *    acepta cliente_id null/undefined (informe sin cliente).
 *  - FK ON DELETE SET NULL: archivar cliente NO dispara el FK (archive es
 *    UPDATE archived_at, no DELETE) — informe mantiene cliente_id intacto.
 *  - audit_log: trigger audit_informes() extendido captura cliente_id en
 *    after_data jsonb del INSERT (decisión T-050 #4 forward-compat T-051).
 *
 * Setup SECUENCIAL (lesson T-047 — Promise.all flaky sa-east-1).
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

const slugA = `t050a-${runId}`;
const slugB = `t050b-${runId}`;
const emailOwnerA = `t050a-own-${runId}@example.com`;
const emailOwnerB = `t050b-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let clienteAId: string;
let clienteBId: string;

beforeAll(async () => {
  // Setup SECUENCIAL — lesson T-047 (Promise.all flaky sa-east-1).
  const { data: cA, error: errCA } = await admin
    .from('consultoras')
    .insert({ name: 'T050A', slug: slugA })
    .select('id')
    .single();
  expect(errCA).toBeNull();
  cAId = cA!.id;

  const { data: cB, error: errCB } = await admin
    .from('consultoras')
    .insert({ name: 'T050B', slug: slugB })
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

  const { data: uOB, error: errUOB } = await admin.auth.admin.createUser({
    email: emailOwnerB,
    password,
    email_confirm: true,
  });
  expect(errUOB).toBeNull();
  ownerBId = uOB.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } });

  // Fixture: cliente en cA + cliente en cB (cross-tenant defense).
  const { data: cliA, error: errCliA } = await admin
    .from('clientes')
    .insert({
      consultora_id: cAId,
      created_by: ownerAId,
      razon_social: 'Acme Industrial T050',
      cuit: '30-50000001-9',
      domicilio: 'Av. Siempreviva 742',
      localidad: 'Mar del Plata',
      provincia: 'BA',
    })
    .select('id')
    .single();
  expect(errCliA).toBeNull();
  clienteAId = cliA!.id;

  const { data: cliB, error: errCliB } = await admin
    .from('clientes')
    .insert({
      consultora_id: cBId,
      created_by: ownerBId,
      razon_social: 'Beta SRL T050',
      cuit: '30-50000002-7',
    })
    .select('id')
    .single();
  expect(errCliB).toBeNull();
  clienteBId = cliB!.id;
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
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

describe('T-050 · createInformeAction con cliente_id', () => {
  it('1. persiste cliente_id válido del propio tenant en INSERT', async () => {
    await signInAs(emailOwnerA);
    const { createInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await createInformeAction({
      tipo: 'rgrl',
      titulo: 'RGRL Acme T050 test1',
      cliente_id: clienteAId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: row, error } = await admin
      .from('informes')
      .select('id, cliente_id, tipo, titulo')
      .eq('id', result.informeId)
      .single();
    expect(error).toBeNull();
    expect(row?.cliente_id).toBe(clienteAId);
    expect(row?.tipo).toBe('rgrl');
  });

  it('2. rechaza cliente_id de otro tenant con INVALID_INPUT (cross-tenant defense)', async () => {
    await signInAs(emailOwnerA);
    const { createInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await createInformeAction({
      tipo: 'rgrl',
      titulo: 'RGRL cross-tenant attempt T050',
      cliente_id: clienteBId, // cliente de cB, ownerA NO debería poder linkearlo.
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
    if (result.code !== 'INVALID_INPUT') return;
    expect(result.fieldErrors.cliente_id).toBeDefined();
    expect(result.fieldErrors.cliente_id?.[0]).toMatch(/no pertenece/i);

    // Confirma que NO se creó row (rejection pre-INSERT).
    const { data: rows } = await admin
      .from('informes')
      .select('id')
      .eq('titulo', 'RGRL cross-tenant attempt T050');
    expect(rows?.length ?? 0).toBe(0);

    // Confirma el warn log para auditoría futura.
    expect(loggerWarnMock).toHaveBeenCalled();
  });

  it('3. acepta cliente_id null/undefined (informe sin cliente vinculado)', async () => {
    await signInAs(emailOwnerA);
    const { createInformeAction } = await import('@/app/(app)/informes/actions');

    // Caso A: cliente_id explícitamente null.
    const r1 = await createInformeAction({
      tipo: 'otros',
      titulo: 'Informe sin cliente T050 null',
      cliente_id: null,
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const { data: row1 } = await admin
      .from('informes')
      .select('cliente_id')
      .eq('id', r1.informeId)
      .single();
    expect(row1?.cliente_id).toBeNull();

    // Caso B: cliente_id omitido (undefined del wizard sin selección).
    const r2 = await createInformeAction({
      tipo: 'otros',
      titulo: 'Informe sin cliente T050 undefined',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const { data: row2 } = await admin
      .from('informes')
      .select('cliente_id')
      .eq('id', r2.informeId)
      .single();
    expect(row2?.cliente_id).toBeNull();
  });

  it('4. archivar cliente NO afecta cliente_id del informe (archive = UPDATE archived_at, no DELETE → FK no se dispara)', async () => {
    // Crear cliente local para este test (no tocar fixture compartido).
    const { data: cliLocal } = await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        created_by: ownerAId,
        razon_social: 'Cliente para archive T050',
        cuit: '30-50000003-5',
      })
      .select('id')
      .single();
    expect(cliLocal).not.toBeNull();
    const cliLocalId = cliLocal!.id;

    await signInAs(emailOwnerA);
    const { createInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await createInformeAction({
      tipo: 'rgrl',
      titulo: 'RGRL para archive test T050',
      cliente_id: cliLocalId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const informeId = result.informeId;

    // Archivar cliente.
    const archiveResult = await admin
      .from('clientes')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', cliLocalId);
    expect(archiveResult.error).toBeNull();

    // El cliente_id del informe debe seguir apuntando al cliente archivado
    // (FK ON DELETE SET NULL solo se dispara con DELETE real, no UPDATE).
    const { data: row } = await admin
      .from('informes')
      .select('cliente_id')
      .eq('id', informeId)
      .single();
    expect(row?.cliente_id).toBe(cliLocalId);
  });

  it('5. audit_log INSERT captura cliente_id en after_data jsonb (forward-compat T-051)', async () => {
    await signInAs(emailOwnerA);
    const { createInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await createInformeAction({
      tipo: 'rgrl',
      titulo: 'RGRL audit cliente_id test T050',
      cliente_id: clienteAId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: auditRows, error } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, before_data, after_data')
      .eq('entity_type', 'informes')
      .eq('entity_id', result.informeId)
      .eq('action', 'created');
    expect(error).toBeNull();
    expect(auditRows?.length).toBe(1);
    const row = auditRows![0]!;
    expect(row.before_data).toBeNull();
    expect(row.after_data).toBeTruthy();
    expect(row.after_data).toMatchObject({
      tipo: 'rgrl',
      titulo: 'RGRL audit cliente_id test T050',
      status: 'draft',
      cliente_id: clienteAId,
    });
  });
});
