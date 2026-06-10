/**
 * T-053 · Tests de integration de las server actions + queries del módulo
 * Empleados.
 *
 * Cobertura:
 *  - createEmpleadoAction: happy path member + DNI normalizado pre-DB +
 *    INVALID_INPUT + UNAUTHENTICATED + NO_CONSULTORA +
 *    CLIENTE_NOT_FOUND_OR_FORBIDDEN cross-tenant defense (lesson T-050) +
 *    DUPLICATE_DNI con reactivación post-archive.
 *  - updateEmpleadoAction: happy patch parcial + audit_log diff + NOT_FOUND +
 *    cross-tenant NOT_FOUND (RLS filtra el SELECT defensivo) + DUPLICATE_DNI
 *    al cambiar DNI a uno colisionante.
 *  - archive/unarchive: archive happy + ALREADY_ARCHIVED + unarchive happy +
 *    ALREADY_ACTIVE + DUPLICATE_DNI edge case en unarchive.
 *  - queries: getEmpleadosByCliente con/sin includeArchived (sort apellido,nombre)
 *    + getEmpleadoById cross-tenant null + searchEmpleadosByNombre
 *    (case-insensitive apellido+nombre, archived excluded, min 2 chars) +
 *    searchEmpleadosByDni (prefix match digits-only, min 3 chars).
 *
 * Setup SECUENCIAL (lesson T-047 — Promise.all sa-east-1 flaky).
 * Cleanup ORDEN FK (lesson T-050): empleados → puestos → clientes → users.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
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

const slugA = `t053a-${runId}`;
const slugB = `t053b-${runId}`;
const emailOwnerA = `t053a-own-${runId}@example.com`;
const emailMemberA = `t053a-mem-${runId}@example.com`;
const emailOwnerB = `t053b-own-${runId}@example.com`;
const emailNoConsul = `t053-nocon-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let noConsulId: string;
let clienteAId: string;
let clienteBId: string;

// Helper: CUITs únicos para los 2 clientes fixtures.
function makeCuit(suffix: string): string {
  return `30-${suffix.padStart(8, '0')}-9`;
}

beforeAll(async () => {
  // Setup SECUENCIAL — lesson T-047 (Promise.all flaky sa-east-1).
  const cA = await createTestConsultora(admin, { name: 'T053A', slug: slugA });
  cAId = cA.id;

  const cB = await createTestConsultora(admin, { name: 'T053B', slug: slugB });
  cBId = cB.id;

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

  // Clientes fixtures (FK obligatorio para empleados).
  const { data: clA, error: errClA } = await admin
    .from('clientes')
    .insert({
      consultora_id: cAId,
      razon_social: `T053 Cliente A ${runId}`,
      cuit: makeCuit('10000001'),
      created_by: ownerAId,
    })
    .select('id')
    .single();
  expect(errClA).toBeNull();
  clienteAId = clA!.id;

  const { data: clB, error: errClB } = await admin
    .from('clientes')
    .insert({
      consultora_id: cBId,
      razon_social: `T053 Cliente B ${runId}`,
      cuit: makeCuit('10000002'),
      created_by: ownerBId,
    })
    .select('id')
    .single();
  expect(errClB).toBeNull();
  clienteBId = clB!.id;
});

afterAll(async () => {
  // Orden FK (lesson T-050): empleados → clientes → users.
  // Cleanup robusto por consultora_id del runId (no solo tracked IDs).
  await admin
    .from('empleados')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  // T-128 · empleados_puestos cascada al borrar empleados; los puestos seedeados
  // se limpian por consultora_id.
  await admin
    .from('puestos')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('clientes')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
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

// Helper: generar DNIs únicos monotónicos para evitar colisiones cross-test
// dentro del mismo cliente (UNIQUE partial WHERE archived_at IS NULL).
// 8 dígitos matchean CHECK SQL `^\d{7,8}$`.
let dniCounter = 30000000;
function nextDni(): string {
  dniCounter += 1;
  return dniCounter.toString();
}

describe('createEmpleadoAction', () => {
  it('1. member non-owner crea empleado en cliente propio → ok:true + created_by=memberAId + consultora_id=cAId', async () => {
    await signInAs(emailMemberA);
    const { createEmpleadoAction } = await import('@/app/(app)/empleados/actions');
    const dni = nextDni();
    const result = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Juan',
      apellido: 'Pérez',
      dni,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: empleado } = await admin
      .from('empleados')
      .select('id, cliente_id, nombre, apellido, dni, created_by, consultora_id, archived_at')
      .eq('id', result.empleadoId)
      .single();
    expect(empleado).toMatchObject({
      cliente_id: clienteAId,
      nombre: 'Juan',
      apellido: 'Pérez',
      dni,
      created_by: memberAId,
      consultora_id: cAId,
      archived_at: null,
    });
  });

  it('2. DNI con puntos "12.345.678" → normaliza a "12345678" pre-DB', async () => {
    await signInAs(emailOwnerA);
    const { createEmpleadoAction } = await import('@/app/(app)/empleados/actions');
    const result = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Ana',
      apellido: 'García',
      dni: '12.345.678',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: empleado } = await admin
      .from('empleados')
      .select('dni')
      .eq('id', result.empleadoId)
      .single();
    expect(empleado?.dni).toBe('12345678'); // Normalizado digits-only.
  });

  it('3. INVALID_INPUT nombre vacío → fieldErrors.nombre', async () => {
    await signInAs(emailOwnerA);
    const { createEmpleadoAction } = await import('@/app/(app)/empleados/actions');
    const result = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: '',
      apellido: 'García',
      dni: nextDni(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
    if (result.code !== 'INVALID_INPUT') return;
    expect(result.fieldErrors.nombre?.length ?? 0).toBeGreaterThan(0);
  });

  it('4. UNAUTHENTICATED sin sesión', async () => {
    cookieStore.length = 0; // sin signIn
    const { createEmpleadoAction } = await import('@/app/(app)/empleados/actions');
    const result = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Juan',
      apellido: 'Pérez',
      dni: nextDni(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('5. NO_CONSULTORA user huérfano', async () => {
    await signInAs(emailNoConsul);
    const { createEmpleadoAction } = await import('@/app/(app)/empleados/actions');
    const result = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Juan',
      apellido: 'Pérez',
      dni: nextDni(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_CONSULTORA');
  });

  it('6. CLIENTE_NOT_FOUND_OR_FORBIDDEN cuando cliente_id es de otro tenant', async () => {
    // memberA (de cA) intenta crear empleado con cliente_id=clienteBId (de cB).
    // Cross-tenant defense pre-INSERT (lesson T-050): SELECT RLS-aware retorna
    // null → CLIENTE_NOT_FOUND_OR_FORBIDDEN. Mensaje genérico (no leak).
    await signInAs(emailMemberA);
    const { createEmpleadoAction } = await import('@/app/(app)/empleados/actions');
    const result = await createEmpleadoAction({
      cliente_id: clienteBId, // cliente de cB
      nombre: 'Intruder',
      apellido: 'Test',
      dni: nextDni(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CLIENTE_NOT_FOUND_OR_FORBIDDEN');
    if (result.code !== 'CLIENTE_NOT_FOUND_OR_FORBIDDEN') return;
    expect(result.fieldErrors.cliente_id.length).toBeGreaterThan(0);

    // Defensive: no se creó ningún empleado en cB.
    const { data: empleadosB } = await admin
      .from('empleados')
      .select('id, nombre')
      .eq('cliente_id', clienteBId)
      .eq('nombre', 'Intruder');
    expect(empleadosB?.length ?? 0).toBe(0);
  });

  it('7. DUPLICATE_DNI mismo cliente + archive del primero permite re-insert', async () => {
    await signInAs(emailOwnerA);
    const { createEmpleadoAction } = await import('@/app/(app)/empleados/actions');
    const dni = nextDni();

    // (a) primer INSERT OK.
    const r1 = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Original',
      apellido: 'Empleado',
      dni,
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const firstId = r1.empleadoId;

    // (b) segundo INSERT mismo DNI mismo cliente → DUPLICATE_DNI.
    const r2 = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Duplicate',
      apellido: 'Test',
      dni,
    });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.code).toBe('DUPLICATE_DNI');
    if (r2.code !== 'DUPLICATE_DNI') return;
    expect(r2.fieldErrors.dni.length).toBeGreaterThan(0);

    // (c) archivar el primero via admin.
    await admin
      .from('empleados')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', firstId);

    // (d) tercer INSERT con MISMO DNI → ok:true (UNIQUE partial permite tras archive).
    const r3 = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Reactivado',
      apellido: 'Empleado',
      dni,
    });
    expect(r3.ok).toBe(true);
  });
});

describe('updateEmpleadoAction', () => {
  it('8. happy path patch parcial apellido → audit_log diff before/after', async () => {
    await signInAs(emailMemberA);
    const { createEmpleadoAction, updateEmpleadoAction } =
      await import('@/app/(app)/empleados/actions');
    // T-128 · el puesto del empleado es el del catálogo: seedeamos uno y lo
    // pasamos por `puesto_id`. createEmpleadoAction asigna el join
    // `empleados_puestos`.
    const puestoNombre = `Operario ${runId}`;
    const { data: puesto } = await admin
      .from('puestos')
      .insert({ consultora_id: cAId, nombre: puestoNombre, created_by: ownerAId })
      .select('id')
      .single();
    expect(puesto).not.toBeNull();

    const created = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Carlos',
      apellido: 'Original',
      dni: nextDni(),
      puesto_id: puesto!.id,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateEmpleadoAction(created.empleadoId, {
      apellido: 'Renombrado',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: empleado } = await admin
      .from('empleados')
      .select('apellido')
      .eq('id', created.empleadoId)
      .single();
    expect(empleado).toMatchObject({ apellido: 'Renombrado' });

    // El patch de apellido no toca la asignación de puesto en el join.
    const { data: joinRow } = await admin
      .from('empleados_puestos')
      .select('puesto_id')
      .eq('empleado_id', created.empleadoId)
      .single();
    expect(joinRow?.puesto_id).toBe(puesto!.id);

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, before_data, after_data')
      .eq('entity_id', created.empleadoId)
      .eq('entity_type', 'empleados')
      .eq('action', 'updated')
      .order('created_at', { ascending: false });
    expect(auditRows?.length ?? 0).toBeGreaterThan(0);
    const latest = auditRows?.[0];
    expect(latest).toBeDefined();
    if (!latest) return;
    const beforeApellido = (latest.before_data as { apellido?: string } | null)?.apellido;
    const afterApellido = (latest.after_data as { apellido?: string } | null)?.apellido;
    expect(beforeApellido).toBe('Original');
    expect(afterApellido).toBe('Renombrado');
  });

  it('9. NOT_FOUND con UUID inexistente', async () => {
    await signInAs(emailOwnerA);
    const { updateEmpleadoAction } = await import('@/app/(app)/empleados/actions');
    const result = await updateEmpleadoAction('00000000-0000-0000-0000-000000000000', {
      apellido: 'Whatever',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('10. Cross-tenant NOT_FOUND: member cA intenta UPDATE empleado de cB', async () => {
    // Crear empleado en cB via admin.
    const { data: empleadoB } = await admin
      .from('empleados')
      .insert({
        consultora_id: cBId,
        cliente_id: clienteBId,
        nombre: 'Beta',
        apellido: 'Tenant',
        dni: nextDni(),
        created_by: ownerBId,
      })
      .select('id')
      .single();

    await signInAs(emailMemberA);
    const { updateEmpleadoAction } = await import('@/app/(app)/empleados/actions');
    const result = await updateEmpleadoAction(empleadoB!.id, {
      apellido: 'Hacked',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');

    // Defensive: empleado real intacto.
    const { data: realEmpleado } = await admin
      .from('empleados')
      .select('apellido')
      .eq('id', empleadoB!.id)
      .single();
    expect(realEmpleado?.apellido).toBe('Tenant');
  });

  it('11. DUPLICATE_DNI al cambiar DNI a uno existente del mismo cliente', async () => {
    await signInAs(emailOwnerA);
    const { createEmpleadoAction, updateEmpleadoAction } =
      await import('@/app/(app)/empleados/actions');
    const dni1 = nextDni();
    const dni2 = nextDni();

    const e1 = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Empleado',
      apellido: 'Uno',
      dni: dni1,
    });
    const e2 = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Empleado',
      apellido: 'Dos',
      dni: dni2,
    });
    expect(e1.ok).toBe(true);
    expect(e2.ok).toBe(true);
    if (!e2.ok) return;

    // e2 intenta tomar el DNI de e1.
    const result = await updateEmpleadoAction(e2.empleadoId, { dni: dni1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DUPLICATE_DNI');
    if (result.code !== 'DUPLICATE_DNI') return;
    expect(result.fieldErrors.dni.length).toBeGreaterThan(0);
  });
});

describe('archive/unarchive', () => {
  it('12. archive happy + ALREADY_ARCHIVED idempotency', async () => {
    await signInAs(emailOwnerA);
    const { createEmpleadoAction, archiveEmpleadoAction } =
      await import('@/app/(app)/empleados/actions');
    const created = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'To',
      apellido: 'Archive',
      dni: nextDni(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const beforeMs = Date.now();
    const r1 = await archiveEmpleadoAction(created.empleadoId);
    const afterMs = Date.now();
    expect(r1.ok).toBe(true);

    const { data: emp } = await admin
      .from('empleados')
      .select('archived_at')
      .eq('id', created.empleadoId)
      .single();
    expect(emp?.archived_at).not.toBeNull();
    const archivedMs = new Date(emp!.archived_at!).getTime();
    expect(archivedMs).toBeGreaterThanOrEqual(beforeMs - 1000);
    expect(archivedMs).toBeLessThanOrEqual(afterMs + 1000);

    // (b) re-archive → ALREADY_ARCHIVED.
    const r2 = await archiveEmpleadoAction(created.empleadoId);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.code).toBe('ALREADY_ARCHIVED');
  });

  it('13. unarchive happy + ALREADY_ACTIVE idempotency', async () => {
    await signInAs(emailOwnerA);
    const { createEmpleadoAction, archiveEmpleadoAction, unarchiveEmpleadoAction } =
      await import('@/app/(app)/empleados/actions');
    const created = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Unarchive',
      apellido: 'Test',
      dni: nextDni(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // (a) archive + unarchive happy → archived_at vuelve a null.
    const arch = await archiveEmpleadoAction(created.empleadoId);
    expect(arch.ok).toBe(true);

    const unarch = await unarchiveEmpleadoAction(created.empleadoId);
    expect(unarch.ok).toBe(true);

    const { data: emp } = await admin
      .from('empleados')
      .select('archived_at')
      .eq('id', created.empleadoId)
      .single();
    expect(emp?.archived_at).toBeNull();

    // (b) unarchive de activo → ALREADY_ACTIVE.
    const unarch2 = await unarchiveEmpleadoAction(created.empleadoId);
    expect(unarch2.ok).toBe(false);
    if (unarch2.ok) return;
    expect(unarch2.code).toBe('ALREADY_ACTIVE');
  });

  it('14. unarchive DUPLICATE_DNI edge case: otro empleado activo con mismo DNI en mismo cliente', async () => {
    await signInAs(emailOwnerA);
    const { createEmpleadoAction, archiveEmpleadoAction, unarchiveEmpleadoAction } =
      await import('@/app/(app)/empleados/actions');
    const dni = nextDni();

    // (a) Crear empleado A con DNI=X.
    const eA = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Original',
      apellido: 'EmpleadoA',
      dni,
    });
    expect(eA.ok).toBe(true);
    if (!eA.ok) return;

    // (b) Archivar A.
    const arch = await archiveEmpleadoAction(eA.empleadoId);
    expect(arch.ok).toBe(true);

    // (c) Crear empleado B con mismo DNI=X en mismo cliente (permitido por UNIQUE partial).
    const eB = await createEmpleadoAction({
      cliente_id: clienteAId,
      nombre: 'Replacement',
      apellido: 'EmpleadoB',
      dni,
    });
    expect(eB.ok).toBe(true);

    // (d) Intentar unarchive de A → DUPLICATE_DNI (UNIQUE partial viola con B activo).
    const result = await unarchiveEmpleadoAction(eA.empleadoId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DUPLICATE_DNI');
    if (result.code !== 'DUPLICATE_DNI') return;
    expect(result.fieldErrors.dni.length).toBeGreaterThan(0);

    // (e) Defensive: A sigue archivado.
    const { data: empA } = await admin
      .from('empleados')
      .select('archived_at')
      .eq('id', eA.empleadoId)
      .single();
    expect(empA?.archived_at).not.toBeNull();
  });
});

describe('queries', () => {
  it('15. getEmpleadosByCliente default → solo activos, sort apellido,nombre; includeArchived:true trae todos', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { getEmpleadosByCliente } = await import('@/app/(app)/empleados/queries');

    // Prefijos únicos por test para evitar interferencia cross-test.
    const prefix = `T15-${runId}`;
    await admin.from('empleados').insert([
      {
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Bob',
        apellido: `${prefix}-Alvarez`,
        dni: nextDni(),
        created_by: ownerAId,
      },
      {
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Ana',
        apellido: `${prefix}-Alvarez`,
        dni: nextDni(),
        created_by: ownerAId,
      },
      {
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Carlos',
        apellido: `${prefix}-Benitez`,
        dni: nextDni(),
        created_by: ownerAId,
      },
      {
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Zulu',
        apellido: `${prefix}-Zigzag`,
        dni: nextDni(),
        created_by: ownerAId,
        archived_at: new Date().toISOString(),
      },
    ]);

    const sb = await createServerClient();

    // (a) default solo activos, sort apellido ASC + nombre ASC.
    const active = await getEmpleadosByCliente(sb, clienteAId, { limit: 200 });
    const filtered = active.filter((e) => e.apellido.startsWith(prefix));
    expect(filtered.map((e) => `${e.apellido} ${e.nombre}`)).toEqual([
      `${prefix}-Alvarez Ana`,
      `${prefix}-Alvarez Bob`,
      `${prefix}-Benitez Carlos`,
    ]);
    expect(filtered.every((e) => e.archived_at === null)).toBe(true);

    // (b) includeArchived:true → incluye Zigzag archivado.
    const all = await getEmpleadosByCliente(sb, clienteAId, {
      includeArchived: true,
      limit: 200,
    });
    const filteredAll = all.filter((e) => e.apellido.startsWith(prefix));
    expect(filteredAll.length).toBe(4);
    expect(filteredAll.some((e) => e.archived_at !== null)).toBe(true);
  });

  it('16. getEmpleadoById cross-tenant → null', async () => {
    // Empleado en cB.
    const { data: empB } = await admin
      .from('empleados')
      .insert({
        consultora_id: cBId,
        cliente_id: clienteBId,
        nombre: 'CrossTenant',
        apellido: 'Defense',
        dni: nextDni(),
        created_by: ownerBId,
      })
      .select('id')
      .single();

    await signInAs(emailMemberA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { getEmpleadoById } = await import('@/app/(app)/empleados/queries');
    const sb = await createServerClient();
    const result = await getEmpleadoById(sb, empB!.id);
    expect(result).toBeNull();
  });

  it('17. searchEmpleadosByNombre + searchEmpleadosByDni — ILIKE apellido+nombre, archived excluded, prefix DNI digits-only', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { searchEmpleadosByNombre, searchEmpleadosByDni } =
      await import('@/app/(app)/empleados/queries');

    const prefix = `T17-${runId}`;
    // Crear 3 activos + 1 archivado. DNIs con prefijo conocido para search por DNI.
    const dniSearchPrefix = '70000';
    const dni1 = `${dniSearchPrefix}001`;
    const dni2 = `${dniSearchPrefix}002`;
    const dni3 = '99999999'; // no matchea prefijo
    const dni4 = `${dniSearchPrefix}999`; // archivado

    await admin.from('empleados').insert([
      {
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Federico',
        apellido: `${prefix}-MARTINEZ`,
        dni: dni1,
        created_by: ownerAId,
      },
      {
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: `${prefix}-martina`,
        apellido: 'González',
        dni: dni2,
        created_by: ownerAId,
      },
      {
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Otro',
        apellido: 'Sin Match',
        dni: dni3,
        created_by: ownerAId,
      },
      {
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Archivado',
        apellido: `${prefix}-MARTINEZ`,
        dni: dni4,
        created_by: ownerAId,
        archived_at: new Date().toISOString(),
      },
    ]);

    const sb = await createServerClient();

    // (a) searchEmpleadosByNombre case-insensitive matchea en APELLIDO ("MARTINEZ").
    const rApellido = await searchEmpleadosByNombre(sb, `${prefix}-martin`);
    const apellidosMatch = rApellido.map((e) => e.apellido).sort();
    expect(apellidosMatch).toContain(`${prefix}-MARTINEZ`);
    // Archivado NO aparece.
    expect(rApellido.some((e) => e.nombre === 'Archivado')).toBe(false);

    // (b) Búsqueda por NOMBRE también: prefix matchea el nombre `${prefix}-martina`.
    // Verificamos que el resultado contenga ese empleado (búsqueda apellido OR nombre).
    expect(rApellido.some((e) => e.nombre === `${prefix}-martina`)).toBe(true);

    // (c) min 2 chars: 'a' devuelve [].
    const rShort = await searchEmpleadosByNombre(sb, 'a');
    expect(rShort).toEqual([]);

    // (d) searchEmpleadosByDni prefix match digits-only.
    const rDni = await searchEmpleadosByDni(sb, dniSearchPrefix);
    const dnisMatch = rDni.map((e) => e.dni);
    expect(dnisMatch).toContain(dni1);
    expect(dnisMatch).toContain(dni2);
    expect(dnisMatch).not.toContain(dni3); // no matchea prefijo
    expect(dnisMatch).not.toContain(dni4); // archivado

    // (e) searchEmpleadosByDni acepta input con puntos: "70.000.001" matchea dni1.
    const rDniDots = await searchEmpleadosByDni(sb, '70.000.001');
    expect(rDniDots.map((e) => e.dni)).toContain(dni1);

    // (f) min 3 chars en DNI: '12' devuelve [].
    const rDniShort = await searchEmpleadosByDni(sb, '12');
    expect(rDniShort).toEqual([]);

    // (g) input no-digits en DNI → [].
    const rDniNonDigit = await searchEmpleadosByDni(sb, 'abc');
    expect(rDniNonDigit).toEqual([]);
  });

  it('18. T-134 · searchEmpleadosByNombre sanea estructurales PostgREST del .or() (inyección + no-sobre-bloqueo)', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const { searchEmpleadosByNombre } = await import('@/app/(app)/empleados/queries');

    const prefix = `T18-${runId}`;
    // Carnada: apellido que termina en "a" — la condición inyectada
    // `apellido.ilike.%a` (lo que PostgREST parsearía si la coma del término
    // separara condiciones) lo traería.
    const apellidoCarnada = `${prefix}-Mendoza`;
    const apellidoApostrofo = `${prefix}-O'Brien`;

    await admin.from('empleados').insert([
      {
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'José',
        apellido: apellidoCarnada,
        dni: nextDni(),
        created_by: ownerAId,
      },
      {
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Aileen',
        apellido: apellidoApostrofo,
        dni: nextDni(),
        created_by: ownerAId,
      },
    ]);

    const sb = await createServerClient();

    // (a) Término inyectado: con el código viejo la coma spliteaba el .or(),
    // `apellido.ilike.%a` leakeaba la carnada y la primera aserción fallaba
    // (rojo). Saneado queda el literal "anombre.ilike." → ninguno de los
    // sembrados puede aparecer. Aserción scopeada a los seeds del run (no `[]`
    // global) para no depender de filas que otros tests dejaron en el tenant.
    const rInyectado = await searchEmpleadosByNombre(sb, 'a,nombre.ilike.%');
    const apellidosInyectado = rInyectado.map((e) => e.apellido);
    expect(apellidosInyectado).not.toContain(apellidoCarnada);
    expect(apellidosInyectado).not.toContain(apellidoApostrofo);

    // (b) Paréntesis: con el código viejo el `(` malformaba el .or() → 400 que
    // la query se traga ({ data } sin chequear error) → [] → esta aserción
    // fallaba (rojo). Saneado, el `(` se descarta y el match literal de
    // O'Brien funciona — cubre "no tira 400" de forma observable, con
    // apóstrofo y paréntesis conviviendo en el mismo término.
    const rParen = await searchEmpleadosByNombre(sb, `${apellidoApostrofo}(`);
    expect(rParen.map((e) => e.apellido)).toContain(apellidoApostrofo);

    // (c) No-sobre-bloqueo: el apóstrofo es char válido de nombre y sigue
    // matcheando (no lo elimina el allowlist). Guard de regresión: verde
    // también con el código viejo.
    const rApostrofo = await searchEmpleadosByNombre(sb, apellidoApostrofo);
    expect(rApostrofo.map((e) => e.apellido)).toContain(apellidoApostrofo);
  });
});
