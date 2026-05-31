/**
 * T-103 · Tests integration de assign/remove server actions de empleados↔puestos.
 *
 * Cobertura:
 *  - assignPuestoAction: happy path member (insert + consultora_id + asignado_por).
 *  - assignPuestoAction: idempotente (PK compuesta colisiona → ok:true silencioso).
 *  - assignPuestoAction: puesto cross-tenant → PUESTO_NOT_FOUND + no INSERT.
 *  - assignPuestoAction: empleado cross-tenant → EMPLEADO_NOT_FOUND + no INSERT.
 *  - assignPuestoAction: puesto archivado → PUESTO_NOT_FOUND.
 *  - assignPuestoAction: INVALID_INPUT (UUID malformado).
 *  - removePuestoAction: happy path.
 *  - removePuestoAction: asignación inexistente → NOT_FOUND.
 *  - removePuestoAction: cross-tenant → NOT_FOUND + row real intacta.
 *
 * Setup SECUENCIAL (lesson T-047 — Promise.all flaky sa-east-1).
 * Cleanup orden FK: empleados_puestos → empleados → puestos → clientes →
 * audit_log → consultora_members → consultoras → users.
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

const slugA = `t103a-${runId}`;
const slugB = `t103b-${runId}`;
const emailOwnerA = `t103a-own-${runId}@example.com`;
const emailMemberA = `t103a-mem-${runId}@example.com`;
const emailOwnerB = `t103b-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let clienteAId: string;
let clienteBId: string;
let empleadoAId: string;
let empleadoBId: string;
let puestoSoldadorAId: string;
let puestoOperarioAId: string;
let puestoArchivadoAId: string;
let puestoSoldadorBId: string;

function makeCuit(suffix: string): string {
  return `30-${suffix.padStart(8, '0')}-9`;
}

beforeAll(async () => {
  // Setup secuencial (lesson T-047).
  const { data: cA } = await admin
    .from('consultoras')
    .insert({ name: 'T103A', slug: slugA })
    .select('id')
    .single();
  cAId = cA!.id;

  const { data: cB } = await admin
    .from('consultoras')
    .insert({ name: 'T103B', slug: slugB })
    .select('id')
    .single();
  cBId = cB!.id;

  const uOA = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  ownerAId = uOA.data.user!.id;

  const uMA = await admin.auth.admin.createUser({
    email: emailMemberA,
    password,
    email_confirm: true,
  });
  memberAId = uMA.data.user!.id;

  const uOB = await admin.auth.admin.createUser({
    email: emailOwnerB,
    password,
    email_confirm: true,
  });
  ownerBId = uOB.data.user!.id;

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

  // Clientes + empleados fixtures.
  const { data: clA } = await admin
    .from('clientes')
    .insert({
      consultora_id: cAId,
      razon_social: `T103 Cliente A ${runId}`,
      cuit: makeCuit('10300001'),
      created_by: ownerAId,
    })
    .select('id')
    .single();
  clienteAId = clA!.id;

  const { data: clB } = await admin
    .from('clientes')
    .insert({
      consultora_id: cBId,
      razon_social: `T103 Cliente B ${runId}`,
      cuit: makeCuit('10300002'),
      created_by: ownerBId,
    })
    .select('id')
    .single();
  clienteBId = clB!.id;

  const { data: empA } = await admin
    .from('empleados')
    .insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'Juan',
      apellido: 'Pérez',
      dni: '30100001',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  empleadoAId = empA!.id;

  const { data: empB } = await admin
    .from('empleados')
    .insert({
      consultora_id: cBId,
      cliente_id: clienteBId,
      nombre: 'Luis',
      apellido: 'Gómez',
      dni: '30200001',
      created_by: ownerBId,
    })
    .select('id')
    .single();
  empleadoBId = empB!.id;

  // Puestos: 2 activos cA, 1 archivado cA, 1 activo cB.
  const { data: pSol } = await admin
    .from('puestos')
    .insert({
      consultora_id: cAId,
      nombre: `Soldador ${runId}`,
      descripcion: 'Soldadura MIG',
      riesgos_asociados: ['electrico', 'quimico'],
      created_by: ownerAId,
    })
    .select('id')
    .single();
  puestoSoldadorAId = pSol!.id;

  const { data: pOp } = await admin
    .from('puestos')
    .insert({
      consultora_id: cAId,
      nombre: `Operario ${runId}`,
      descripcion: null,
      riesgos_asociados: null,
      created_by: ownerAId,
    })
    .select('id')
    .single();
  puestoOperarioAId = pOp!.id;

  const { data: pArch } = await admin
    .from('puestos')
    .insert({
      consultora_id: cAId,
      nombre: `Archivado ${runId}`,
      archived_at: new Date().toISOString(),
      created_by: ownerAId,
    })
    .select('id')
    .single();
  puestoArchivadoAId = pArch!.id;

  const { data: pSolB } = await admin
    .from('puestos')
    .insert({
      consultora_id: cBId,
      nombre: `Soldador B ${runId}`,
      created_by: ownerBId,
    })
    .select('id')
    .single();
  puestoSoldadorBId = pSolB!.id;
});

afterAll(async () => {
  await admin
    .from('empleados_puestos')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('puestos')
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
    .from('audit_log')
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

beforeEach(async () => {
  cookieStore.length = 0;
  loggerWarnMock.mockClear();
  loggerErrorMock.mockClear();
  loggerInfoMock.mockClear();
  // Reset asignaciones entre tests para mantener cada test independiente.
  await admin
    .from('empleados_puestos')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
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

// =================================== TESTS ===================================

describe('assignPuestoAction', () => {
  it('1. member crea asignación → ok:true + consultora_id y asignado_por seteados', async () => {
    await signInAs(emailMemberA);
    const { assignPuestoAction } = await import('@/app/(app)/empleados/[id]/puestos/actions');
    const result = await assignPuestoAction({
      empleado_id: empleadoAId,
      puesto_id: puestoSoldadorAId,
    });
    expect(result.ok).toBe(true);

    const { data: row } = await admin
      .from('empleados_puestos')
      .select('empleado_id, puesto_id, consultora_id, asignado_por')
      .eq('empleado_id', empleadoAId)
      .eq('puesto_id', puestoSoldadorAId)
      .single();
    expect(row).toMatchObject({
      empleado_id: empleadoAId,
      puesto_id: puestoSoldadorAId,
      consultora_id: cAId,
      asignado_por: memberAId,
    });
  });

  it('2. asignar el mismo puesto dos veces → segunda llamada ok:true (idempotente)', async () => {
    await signInAs(emailOwnerA);
    const { assignPuestoAction } = await import('@/app/(app)/empleados/[id]/puestos/actions');
    const r1 = await assignPuestoAction({
      empleado_id: empleadoAId,
      puesto_id: puestoSoldadorAId,
    });
    expect(r1.ok).toBe(true);

    const r2 = await assignPuestoAction({
      empleado_id: empleadoAId,
      puesto_id: puestoSoldadorAId,
    });
    expect(r2.ok).toBe(true);

    // Solo 1 fila — la PK compuesta bloqueó la segunda y la action lo capturó.
    const { count } = await admin
      .from('empleados_puestos')
      .select('*', { count: 'exact', head: true })
      .eq('empleado_id', empleadoAId)
      .eq('puesto_id', puestoSoldadorAId);
    expect(count).toBe(1);
  });

  it('3. puesto de otra consultora → PUESTO_NOT_FOUND + no INSERT', async () => {
    await signInAs(emailMemberA);
    const { assignPuestoAction } = await import('@/app/(app)/empleados/[id]/puestos/actions');
    const result = await assignPuestoAction({
      empleado_id: empleadoAId,
      puesto_id: puestoSoldadorBId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PUESTO_NOT_FOUND');

    const { count } = await admin
      .from('empleados_puestos')
      .select('*', { count: 'exact', head: true })
      .eq('empleado_id', empleadoAId)
      .eq('puesto_id', puestoSoldadorBId);
    expect(count).toBe(0);
  });

  it('4. empleado de otra consultora → EMPLEADO_NOT_FOUND + no INSERT', async () => {
    await signInAs(emailMemberA);
    const { assignPuestoAction } = await import('@/app/(app)/empleados/[id]/puestos/actions');
    const result = await assignPuestoAction({
      empleado_id: empleadoBId,
      puesto_id: puestoSoldadorAId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EMPLEADO_NOT_FOUND');

    const { count } = await admin
      .from('empleados_puestos')
      .select('*', { count: 'exact', head: true })
      .eq('empleado_id', empleadoBId);
    expect(count).toBe(0);
  });

  it('5. puesto archivado → PUESTO_NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { assignPuestoAction } = await import('@/app/(app)/empleados/[id]/puestos/actions');
    const result = await assignPuestoAction({
      empleado_id: empleadoAId,
      puesto_id: puestoArchivadoAId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PUESTO_NOT_FOUND');
  });

  it('6. UUID inválido → INVALID_INPUT', async () => {
    await signInAs(emailOwnerA);
    const { assignPuestoAction } = await import('@/app/(app)/empleados/[id]/puestos/actions');
    const result = await assignPuestoAction({
      empleado_id: 'not-a-uuid',
      puesto_id: puestoSoldadorAId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
  });
});

describe('removePuestoAction', () => {
  it('7. happy path: quita asignación existente', async () => {
    // Pre-seed: asignar via admin para aislar el test del assign action.
    await admin.from('empleados_puestos').insert({
      empleado_id: empleadoAId,
      puesto_id: puestoOperarioAId,
      consultora_id: cAId,
      asignado_por: ownerAId,
    });
    await signInAs(emailOwnerA);
    const { removePuestoAction } = await import('@/app/(app)/empleados/[id]/puestos/actions');
    const result = await removePuestoAction({
      empleado_id: empleadoAId,
      puesto_id: puestoOperarioAId,
    });
    expect(result.ok).toBe(true);

    const { count } = await admin
      .from('empleados_puestos')
      .select('*', { count: 'exact', head: true })
      .eq('empleado_id', empleadoAId)
      .eq('puesto_id', puestoOperarioAId);
    expect(count).toBe(0);
  });

  it('8. asignación inexistente → NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { removePuestoAction } = await import('@/app/(app)/empleados/[id]/puestos/actions');
    const result = await removePuestoAction({
      empleado_id: empleadoAId,
      puesto_id: puestoSoldadorAId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('9. cross-tenant: member de cA no puede quitar asignación de cB → NOT_FOUND + row B intacta', async () => {
    // Pre-seed: asignación en cB.
    await admin.from('empleados_puestos').insert({
      empleado_id: empleadoBId,
      puesto_id: puestoSoldadorBId,
      consultora_id: cBId,
      asignado_por: ownerBId,
    });

    await signInAs(emailMemberA);
    const { removePuestoAction } = await import('@/app/(app)/empleados/[id]/puestos/actions');
    const result = await removePuestoAction({
      empleado_id: empleadoBId,
      puesto_id: puestoSoldadorBId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');

    // Row B intacta.
    const { count } = await admin
      .from('empleados_puestos')
      .select('*', { count: 'exact', head: true })
      .eq('empleado_id', empleadoBId)
      .eq('puesto_id', puestoSoldadorBId);
    expect(count).toBe(1);
  });
});
