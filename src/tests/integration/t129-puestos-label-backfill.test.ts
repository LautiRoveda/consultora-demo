/**
 * T-129 (fase A) · Integration: helper `getEmpleadoPuestosLabel` (catálogo) +
 * backfill `backfill_empleados_puestos_from_legacy`.
 *
 * Cobertura:
 *  - Helper: 0 puestos → null; 1 → nombre; 2 activos → concatenado en orden
 *    `asignado_at desc`; activo + archivado → sólo el activo (excluye archivados).
 *  - Backfill (vía RPC service-role, ACOTADO a la consultora del test con
 *    p_consultora_id → no contamina otros tests): crea+asigna puesto nuevo,
 *    reusa un puesto activo existente (case-insensitive), trunca nombres > 80,
 *    setea created_by/asignado_por = owner, e idempotencia en el re-run.
 *
 * service-role admin: NO testeamos RLS. runId namespacing + cleanup en orden FK.
 * El backfill se invoca con un cliente sin genéricos para castear el jsonb de
 * retorno a un tipo propio sin pelear con el tipo `Json` del rpc tipado.
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
// Cliente SIN genéricos: el rpc devuelve `any`, así casteamos el jsonb de retorno
// a BackfillResult sin pelear con el tipo `Json` del rpc tipado.
const adminRpc = createSbClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const email = `t129-own-${runId}@example.com`;

let cId: string;
let ownerId: string;
let clienteId: string;

// Helper-test empleados (estado del catálogo explícito, sin texto legacy).
let empSinPuestos: string;
let empUnPuesto: string;
let empDosPuestos: string;
let empConArchivado: string;
let puestoSoldadorId: string;

// Backfill-test empleados (texto legacy + sin asignación).
let empLegacyNuevo: string;
let empLegacyExistente: string;
let empLegacyLargo: string;

const NOMBRE_SOLDADOR = `Soldador ${runId}`;
const NOMBRE_LARGO = `Cargo ${runId} ${'a'.repeat(100)}`; // > 80 chars, < 120

let dniCounter = 40000000;

async function insertEmpleado(nombre: string, puesto: string | null): Promise<string> {
  const dni = String(dniCounter++); // determinista → sin colisiones entre fixtures
  const { data, error } = await admin
    .from('empleados')
    .insert({
      consultora_id: cId,
      cliente_id: clienteId,
      nombre,
      apellido: `Test ${runId}`,
      dni,
      puesto,
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

  // — Empleados de los tests del HELPER (asignaciones explícitas, sin texto legacy) —
  empSinPuestos = await insertEmpleado('SinPuestos', null);

  empUnPuesto = await insertEmpleado('UnPuesto', null);
  puestoSoldadorId = await insertPuesto(NOMBRE_SOLDADOR, false);
  await assignPuesto(empUnPuesto, puestoSoldadorId, '2026-01-01T10:00:00Z');

  empDosPuestos = await insertEmpleado('DosPuestos', null);
  const pOperario = await insertPuesto(`Operario ${runId}`, false);
  const pCapataz = await insertPuesto(`Capataz ${runId}`, false);
  await assignPuesto(empDosPuestos, pOperario, '2026-01-01T10:00:00Z'); // más viejo
  await assignPuesto(empDosPuestos, pCapataz, '2026-02-01T10:00:00Z'); // más reciente → primero

  empConArchivado = await insertEmpleado('ConArchivado', null);
  const pVigente = await insertPuesto(`Vigente ${runId}`, false);
  const pArchivado = await insertPuesto(`Archivado ${runId}`, true);
  await assignPuesto(empConArchivado, pVigente, '2026-01-01T10:00:00Z');
  await assignPuesto(empConArchivado, pArchivado, '2026-02-01T10:00:00Z');

  // — Empleados del BACKFILL (texto legacy + SIN asignación) —
  empLegacyNuevo = await insertEmpleado('LegacyNuevo', `Electricista ${runId}`);
  // Texto en minúscula que matchea case-insensitive al puesto activo NOMBRE_SOLDADOR.
  empLegacyExistente = await insertEmpleado('LegacyExistente', `soldador ${runId}`);
  empLegacyLargo = await insertEmpleado('LegacyLargo', NOMBRE_LARGO);
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

describe('backfill_empleados_puestos_from_legacy', () => {
  type BackfillResult = {
    puestos_creados: number;
    asignaciones: number;
    skipped: number;
    errores: unknown[];
  };

  it('migra los empleados con texto legacy de la consultora: crea, reusa (case-insensitive), trunca a 80', async () => {
    const { data, error } = await adminRpc.rpc('backfill_empleados_puestos_from_legacy', {
      p_consultora_id: cId,
    });
    expect(error).toBeNull();
    const res = data as BackfillResult;

    // Nuevo (Electricista) + largo (truncado) = 2 creados. Existente (soldador) reusa.
    // 3 empleados elegibles → 3 asignaciones, 0 skipped.
    expect(res.puestos_creados).toBe(2);
    expect(res.asignaciones).toBe(3);
    expect(res.skipped).toBe(0);
    expect(res.errores).toEqual([]);

    // (a) Nuevo: puesto creado + asignado, created_by/asignado_por = owner.
    expect(await getEmpleadoPuestosLabel(admin, empLegacyNuevo)).toBe(`Electricista ${runId}`);
    const { data: pNuevo } = await admin
      .from('puestos')
      .select('id, created_by')
      .eq('consultora_id', cId)
      .eq('nombre', `Electricista ${runId}`)
      .single();
    expect(pNuevo!.created_by).toBe(ownerId);
    const { data: aNuevo } = await admin
      .from('empleados_puestos')
      .select('asignado_por')
      .eq('empleado_id', empLegacyNuevo)
      .single();
    expect(aNuevo!.asignado_por).toBe(ownerId);

    // (b) Existente: reusa el puesto activo NOMBRE_SOLDADOR (no crea uno nuevo).
    const { data: asignExistente } = await admin
      .from('empleados_puestos')
      .select('puesto_id')
      .eq('empleado_id', empLegacyExistente)
      .single();
    expect(asignExistente!.puesto_id).toBe(puestoSoldadorId);
    const { count: soldadorCount } = await admin
      .from('puestos')
      .select('id', { count: 'exact', head: true })
      .eq('consultora_id', cId)
      .ilike('nombre', NOMBRE_SOLDADOR);
    expect(soldadorCount).toBe(1); // sigue habiendo UN solo "Soldador"

    // (c) Largo: el puesto creado tiene nombre truncado a 80 chars.
    const label = await getEmpleadoPuestosLabel(admin, empLegacyLargo);
    expect(label).not.toBeNull();
    expect(label!.length).toBe(80);
    expect(label!.startsWith(`Cargo ${runId}`)).toBe(true);
  });

  it('re-run es idempotente: nada nuevo creado ni asignado', async () => {
    const { data, error } = await adminRpc.rpc('backfill_empleados_puestos_from_legacy', {
      p_consultora_id: cId,
    });
    expect(error).toBeNull();
    const res = data as BackfillResult;
    expect(res.puestos_creados).toBe(0);
    expect(res.asignaciones).toBe(0);
    expect(res.skipped).toBe(0);
  });
});
