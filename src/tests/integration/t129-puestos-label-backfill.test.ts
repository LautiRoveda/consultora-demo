/**
 * T-129 · Integration: helper `getEmpleadoPuestosLabel` (catálogo).
 *
 * Cobertura: 0 puestos → null; 1 → nombre; 2 activos → concatenado en orden
 * `asignado_at desc`; activo + archivado → sólo el activo (excluye archivados).
 *
 * (Fase A incluía además tests del backfill `backfill_empleados_puestos_from_legacy`;
 * fase B dropeó esa función y la columna legacy `empleados.puesto`, así que esos
 * casos se eliminaron.)
 *
 * service-role admin: NO testeamos RLS. runId namespacing + cleanup en orden FK.
 *
 * Correr local (Supabase efímero, requiere Docker):
 *   pnpm test:integration src/tests/integration/t129-puestos-label-backfill.test.ts
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getEmpleadoPuestosLabel } from '@/app/(app)/empleados/queries';

vi.mock('server-only', () => ({}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (pnpm test:integration).',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const email = `t129-own-${runId}@example.com`;

let cId: string;
let ownerId: string;
let clienteId: string;

// Helper-test empleados (estado del catálogo explícito).
let empSinPuestos: string;
let empUnPuesto: string;
let empDosPuestos: string;
let empConArchivado: string;
let puestoSoldadorId: string;

const NOMBRE_SOLDADOR = `Soldador ${runId}`;

let dniCounter = 40000000;

async function insertEmpleado(nombre: string): Promise<string> {
  const dni = String(dniCounter++); // determinista → sin colisiones entre fixtures
  const { data, error } = await admin
    .from('empleados')
    .insert({
      consultora_id: cId,
      cliente_id: clienteId,
      nombre,
      apellido: `Test ${runId}`,
      dni,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insert empleado ${nombre}: ${JSON.stringify(error)}`);
  return data.id;
}

async function insertPuesto(nombre: string, archived: boolean): Promise<string> {
  const { data, error } = await admin
    .from('puestos')
    .insert({ consultora_id: cId, nombre, archived_at: archived ? new Date().toISOString() : null })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insert puesto ${nombre}: ${JSON.stringify(error)}`);
  return data.id;
}

async function assignPuesto(
  empleadoId: string,
  puestoId: string,
  asignadoAt: string,
): Promise<void> {
  const { error } = await admin.from('empleados_puestos').insert({
    empleado_id: empleadoId,
    puesto_id: puestoId,
    consultora_id: cId,
    asignado_at: asignadoAt,
  });
  if (error) throw new Error(`assign ${empleadoId}->${puestoId}: ${JSON.stringify(error)}`);
}

beforeAll(async () => {
  // Setup secuencial (lesson T-047).
  const c = await admin
    .from('consultoras')
    .insert({ name: `T129 ${runId}`, slug: `t129-${runId}` })
    .select('id')
    .single();
  if (c.error || !c.data) throw new Error(`insert consultora: ${JSON.stringify(c.error)}`);
  cId = c.data.id;

  const u = await admin.auth.admin.createUser({
    email,
    password: 'TestPassword123!',
    email_confirm: true,
  });
  if (u.error || !u.data.user) throw new Error(`createUser: ${JSON.stringify(u.error)}`);
  ownerId = u.data.user.id;

  const m = await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: cId, role: 'owner' });
  if (m.error) throw new Error(`insert member: ${JSON.stringify(m.error)}`);

  const cli = await admin
    .from('clientes')
    .insert({ consultora_id: cId, razon_social: `T129 cliente ${runId}`, cuit: '30-12345678-9' })
    .select('id')
    .single();
  if (cli.error || !cli.data) throw new Error(`insert cliente: ${JSON.stringify(cli.error)}`);
  clienteId = cli.data.id;

  // — Empleados de los tests del HELPER (asignaciones explícitas) —
  empSinPuestos = await insertEmpleado('SinPuestos');

  empUnPuesto = await insertEmpleado('UnPuesto');
  puestoSoldadorId = await insertPuesto(NOMBRE_SOLDADOR, false);
  await assignPuesto(empUnPuesto, puestoSoldadorId, '2026-01-01T10:00:00Z');

  empDosPuestos = await insertEmpleado('DosPuestos');
  const pOperario = await insertPuesto(`Operario ${runId}`, false);
  const pCapataz = await insertPuesto(`Capataz ${runId}`, false);
  await assignPuesto(empDosPuestos, pOperario, '2026-01-01T10:00:00Z'); // más viejo
  await assignPuesto(empDosPuestos, pCapataz, '2026-02-01T10:00:00Z'); // más reciente → primero

  empConArchivado = await insertEmpleado('ConArchivado');
  const pVigente = await insertPuesto(`Vigente ${runId}`, false);
  const pArchivado = await insertPuesto(`Archivado ${runId}`, true);
  await assignPuesto(empConArchivado, pVigente, '2026-01-01T10:00:00Z');
  await assignPuesto(empConArchivado, pArchivado, '2026-02-01T10:00:00Z');
});

afterAll(async () => {
  await admin
    .from('empleados_puestos')
    .delete()
    .eq('consultora_id', cId)
    .then(() => {});
  await admin
    .from('empleados')
    .delete()
    .eq('consultora_id', cId)
    .then(() => {});
  await admin
    .from('puestos')
    .delete()
    .eq('consultora_id', cId)
    .then(() => {});
  await admin
    .from('clientes')
    .delete()
    .eq('consultora_id', cId)
    .then(() => {});
  await admin
    .from('consultora_members')
    .delete()
    .eq('consultora_id', cId)
    .then(() => {});
  // consultora queda (audit_log RESTRICT) — best-effort, lo limpia el db reset de CI.
  await admin.auth.admin.deleteUser(ownerId).then(() => {});
});

describe('getEmpleadoPuestosLabel', () => {
  it('sin puestos asignados → null', async () => {
    expect(await getEmpleadoPuestosLabel(admin, empSinPuestos)).toBeNull();
  });

  it('un puesto → su nombre', async () => {
    expect(await getEmpleadoPuestosLabel(admin, empUnPuesto)).toBe(NOMBRE_SOLDADOR);
  });

  it('dos puestos activos → concatenados, más reciente primero', async () => {
    expect(await getEmpleadoPuestosLabel(admin, empDosPuestos)).toBe(
      `Capataz ${runId}, Operario ${runId}`,
    );
  });

  it('puesto activo + archivado → sólo el activo (excluye archivados)', async () => {
    expect(await getEmpleadoPuestosLabel(admin, empConArchivado)).toBe(`Vigente ${runId}`);
  });
});
