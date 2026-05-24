/**
 * T-103 · Tests integration de queries empleados↔puestos.
 *
 * Cobertura:
 *  - listPuestosAsignados: shape correcto + ORDER BY asignado_at DESC + incluye
 *    archived_at (UI los marca con badge "archivado").
 *  - listPuestosDisponiblesParaAsignar: excluye ya asignados + excluye
 *    archivados + ordena alfabético + cross-tenant filtrado por RLS.
 *
 * Usa Supabase client server-side (RLS aplica) tras signIn.
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
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';

const slugA = `t103q-a-${runId}`;
const slugB = `t103q-b-${runId}`;
const emailOwnerA = `t103q-a-${runId}@example.com`;
const emailOwnerB = `t103q-b-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let clienteAId: string;
let clienteBId: string;
let empleadoAId: string;
let puestoSoldadorAId: string;
let puestoOperarioAId: string;
let puestoElectricistaAId: string;
let puestoArchivadoAId: string;
let puestoSoldadorBId: string;

function makeCuit(suffix: string): string {
  return `30-${suffix.padStart(8, '0')}-9`;
}

beforeAll(async () => {
  const { data: cA } = await admin
    .from('consultoras')
    .insert({ name: 'T103Q-A', slug: slugA })
    .select('id')
    .single();
  cAId = cA!.id;
  const { data: cB } = await admin
    .from('consultoras')
    .insert({ name: 'T103Q-B', slug: slugB })
    .select('id')
    .single();
  cBId = cB!.id;

  const uOA = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  ownerAId = uOA.data.user!.id;
  const uOB = await admin.auth.admin.createUser({
    email: emailOwnerB,
    password,
    email_confirm: true,
  });
  ownerBId = uOB.data.user!.id;

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

  const { data: clA } = await admin
    .from('clientes')
    .insert({
      consultora_id: cAId,
      razon_social: `T103Q Cliente A ${runId}`,
      cuit: makeCuit('10301001'),
      created_by: ownerAId,
    })
    .select('id')
    .single();
  clienteAId = clA!.id;
  const { data: clB } = await admin
    .from('clientes')
    .insert({
      consultora_id: cBId,
      razon_social: `T103Q Cliente B ${runId}`,
      cuit: makeCuit('10301002'),
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
      nombre: 'Ana',
      apellido: 'Cabral',
      dni: '30301001',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  empleadoAId = empA!.id;
  // Empleado en cB existe solo para validar que RLS lo aísla de queries de A.
  await admin
    .from('empleados')
    .insert({
      consultora_id: cBId,
      cliente_id: clienteBId,
      nombre: 'Pablo',
      apellido: 'Diaz',
      dni: '30302001',
      created_by: ownerBId,
    })
    .select('id')
    .single();

  // Puestos cA: Soldador (asignado) + Operario (no asignado) + Electricista (no
  // asignado) + Archivado (archivado).
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
      created_by: ownerAId,
    })
    .select('id')
    .single();
  puestoOperarioAId = pOp!.id;

  const { data: pEl } = await admin
    .from('puestos')
    .insert({
      consultora_id: cAId,
      nombre: `Electricista ${runId}`,
      created_by: ownerAId,
    })
    .select('id')
    .single();
  puestoElectricistaAId = pEl!.id;

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
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
});

beforeEach(async () => {
  cookieStore.length = 0;
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

describe('listPuestosAsignados', () => {
  it('1. shape correcto + ORDER BY asignado_at DESC + incluye archived_at del puesto', async () => {
    // Asignar 3 puestos al empleadoA en orden temporal explícito.
    const earlier = new Date(Date.now() - 60_000).toISOString();
    const middle = new Date(Date.now() - 30_000).toISOString();
    const later = new Date(Date.now() - 1_000).toISOString();
    await admin.from('empleados_puestos').insert([
      {
        empleado_id: empleadoAId,
        puesto_id: puestoOperarioAId,
        consultora_id: cAId,
        asignado_por: ownerAId,
        asignado_at: earlier,
      },
      {
        empleado_id: empleadoAId,
        puesto_id: puestoSoldadorAId,
        consultora_id: cAId,
        asignado_por: ownerAId,
        asignado_at: middle,
      },
      {
        empleado_id: empleadoAId,
        puesto_id: puestoElectricistaAId,
        consultora_id: cAId,
        asignado_por: ownerAId,
        asignado_at: later,
      },
    ]);

    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { listPuestosAsignados } = await import('@/app/(app)/empleados/[id]/puestos/queries');
    const result = await listPuestosAsignados(sb, empleadoAId);

    expect(result.length).toBe(3);
    expect(result[0]?.puesto_id).toBe(puestoElectricistaAId); // más reciente
    expect(result[2]?.puesto_id).toBe(puestoOperarioAId); // más viejo
    expect(result[1]).toMatchObject({
      puesto_id: puestoSoldadorAId,
      nombre: `Soldador ${runId}`,
      descripcion: 'Soldadura MIG',
      riesgos_asociados: ['electrico', 'quimico'],
      archived_at: null,
    });
  });

  it('2. expone archived_at != null cuando el puesto se archivó después de asignarlo', async () => {
    await admin.from('empleados_puestos').insert({
      empleado_id: empleadoAId,
      puesto_id: puestoArchivadoAId,
      consultora_id: cAId,
      asignado_por: ownerAId,
    });

    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { listPuestosAsignados } = await import('@/app/(app)/empleados/[id]/puestos/queries');
    const result = await listPuestosAsignados(sb, empleadoAId);
    expect(result.length).toBe(1);
    expect(result[0]?.puesto_id).toBe(puestoArchivadoAId);
    expect(result[0]?.archived_at).not.toBeNull();
  });
});

describe('listPuestosDisponiblesParaAsignar', () => {
  it('3. excluye los ya asignados + excluye archivados + ordena alfabético', async () => {
    // Asignar Soldador → debe quedar fuera. Resto: Operario y Electricista.
    await admin.from('empleados_puestos').insert({
      empleado_id: empleadoAId,
      puesto_id: puestoSoldadorAId,
      consultora_id: cAId,
      asignado_por: ownerAId,
    });

    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { listPuestosDisponiblesParaAsignar } =
      await import('@/app/(app)/empleados/[id]/puestos/queries');
    const result = await listPuestosDisponiblesParaAsignar(sb, empleadoAId, cAId);

    const ids = result.map((p) => p.id);
    expect(ids).toContain(puestoOperarioAId);
    expect(ids).toContain(puestoElectricistaAId);
    expect(ids).not.toContain(puestoSoldadorAId); // ya asignado
    expect(ids).not.toContain(puestoArchivadoAId); // archivado
    expect(ids).not.toContain(puestoSoldadorBId); // otra consultora

    // Orden alfabético — `Electricista ${runId}` < `Operario ${runId}`.
    const nombres = result.map((p) => p.nombre);
    const sorted = [...nombres].sort();
    expect(nombres).toEqual(sorted);
  });

  it('4. cross-tenant: ownerA NO ve puestos disponibles de cB aunque pase consultora_id de cB', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { listPuestosDisponiblesParaAsignar } =
      await import('@/app/(app)/empleados/[id]/puestos/queries');
    // OwnerA pasa cBId — RLS filtra a 0 filas porque no es member de cB.
    const result = await listPuestosDisponiblesParaAsignar(sb, empleadoAId, cBId);
    expect(result.length).toBe(0);
  });
});
