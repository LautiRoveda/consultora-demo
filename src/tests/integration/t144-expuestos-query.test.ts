/**
 * T-144 · `listExpuestosByCliente` — nómina de trabajadores expuestos para la
 * planilla RAR. Herencia puesto→empleado de la Fase 1.
 *
 * Cobertura:
 *  - Herencia: empleado con 2 puestos hereda la UNIÓN de agentes SIN duplicar
 *    el agente compartido.
 *  - "Expuesto" = ≥1 agente: empleado con puesto sin agentes NO se lista.
 *  - Solo activos: empleado `archived_at != null` excluido.
 *  - `faltan_datos`: empleado sin CUIL / fecha_ingreso aparece igual, marcado.
 *  - Set distinct de agentes del establecimiento (DAR).
 *  - RLS cross-tenant: el client de otra consultora ve nómina vacía.
 *
 * clients anon con session firmada (RLS real, NO service-role). Molde
 * t143-rar-rls.test.ts.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration -- t144-expuestos-query`.
 */
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

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
const slugA = `t144-q-a-${runId}`;
const slugB = `t144-q-b-${runId}`;
const emailOwnerA = `t144-q-own-a-${runId}@example.com`;
const emailOwnerB = `t144-q-own-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let clienteAId: string;
let clientOwnerA: SupabaseClient<Database>;
let clientOwnerB: SupabaseClient<Database>;

let agFisicoId: string; // compartido entre soldador y pintor
let agQuimicoId: string; // solo soldador
let agExtraId: string; // expuesto al soldador SOLO en clienteOtro (guard cliente-scoping)
let clienteOtroId: string; // otro establecimiento del mismo tenant

let empMultiId: string; // 2 puestos (soldador + pintor), datos completos
let empFaltaId: string; // 1 puesto (soldador), sin CUIL ni fecha_ingreso
let empSinAgenteId: string; // puesto admin (sin agentes) → NO expuesto
let empArchivadoId: string; // archivado → excluido

beforeAll(async () => {
  cAId = (
    await admin.from('consultoras').insert({ name: 'T144 Q A', slug: slugA }).select('id').single()
  ).data!.id;
  cBId = (
    await admin.from('consultoras').insert({ name: 'T144 Q B', slug: slugB }).select('id').single()
  ).data!.id;

  ownerAId = (
    await admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true })
  ).data.user!.id;
  ownerBId = (
    await admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true })
  ).data.user!.id;

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

  const sbOA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbOB = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await sbOA.auth.signInWithPassword({ email: emailOwnerA, password });
  await sbOB.auth.signInWithPassword({ email: emailOwnerB, password });
  clientOwnerA = sbOA;
  clientOwnerB = sbOB;

  const cuitBase = Date.now().toString().slice(-8).padStart(8, '0');
  clienteAId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Cliente T144Q ${runId}`,
        cuit: `30-${cuitBase}-5`,
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;

  // Agentes.
  agFisicoId = (
    await admin
      .from('rar_agentes')
      .insert({
        consultora_id: cAId,
        codigo: `RAF-${runId}`,
        nombre: 'Ruido',
        agente_tipo: 'fisico',
      })
      .select('id')
      .single()
  ).data!.id;
  agQuimicoId = (
    await admin
      .from('rar_agentes')
      .insert({
        consultora_id: cAId,
        codigo: `RAQ-${runId}`,
        nombre: 'Solventes',
        agente_tipo: 'quimico',
      })
      .select('id')
      .single()
  ).data!.id;

  // Puestos.
  const pstSoldadorId = (
    await admin
      .from('puestos')
      .insert({ consultora_id: cAId, nombre: `Soldador ${runId}` })
      .select('id')
      .single()
  ).data!.id;
  const pstPintorId = (
    await admin
      .from('puestos')
      .insert({ consultora_id: cAId, nombre: `Pintor ${runId}` })
      .select('id')
      .single()
  ).data!.id;
  const pstAdminId = (
    await admin
      .from('puestos')
      .insert({ consultora_id: cAId, nombre: `Admin ${runId}` })
      .select('id')
      .single()
  ).data!.id;

  // Exposición POR ESTABLECIMIENTO (T-145): en el cliente A → soldador
  // {fisico, quimico}; pintor {fisico}; admin {}.
  await admin.from('cliente_puesto_agentes').insert([
    {
      cliente_id: clienteAId,
      puesto_id: pstSoldadorId,
      agente_id: agFisicoId,
      consultora_id: cAId,
    },
    {
      cliente_id: clienteAId,
      puesto_id: pstSoldadorId,
      agente_id: agQuimicoId,
      consultora_id: cAId,
    },
    { cliente_id: clienteAId, puesto_id: pstPintorId, agente_id: agFisicoId, consultora_id: cAId },
  ]);

  // Guard del refactor: el MISMO puesto (soldador) expone a un agente EXTRA en
  // OTRO cliente del tenant. El empleado del cliente A NO debe heredarlo (la
  // exposición es cliente×puesto, no puesto-global).
  const cuitOtro = (Date.now() + 7).toString().slice(-8).padStart(8, '0');
  clienteOtroId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Cliente Otro T144Q ${runId}`,
        cuit: `30-${cuitOtro}-7`,
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  agExtraId = (
    await admin
      .from('rar_agentes')
      .insert({
        consultora_id: cAId,
        codigo: `RAX-${runId}`,
        nombre: 'Vibraciones',
        agente_tipo: 'fisico',
      })
      .select('id')
      .single()
  ).data!.id;
  await admin.from('cliente_puesto_agentes').insert({
    cliente_id: clienteOtroId,
    puesto_id: pstSoldadorId,
    agente_id: agExtraId,
    consultora_id: cAId,
  });

  // Empleados.
  empMultiId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Mario',
        apellido: 'Albo',
        dni: '20111222',
        cuil: '20-20111222-3',
        fecha_ingreso: '2020-03-15',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  empFaltaId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Berta',
        apellido: 'Bravo',
        dni: '20333444',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  empSinAgenteId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Carla',
        apellido: 'Cruz',
        dni: '20555666',
        cuil: '27-20555666-4',
        fecha_ingreso: '2021-01-10',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  empArchivadoId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Diego',
        apellido: 'Diaz',
        dni: '20777888',
        cuil: '20-20777888-5',
        fecha_ingreso: '2019-06-01',
        created_by: ownerAId,
        archived_at: new Date().toISOString(),
      })
      .select('id')
      .single()
  ).data!.id;

  // empleados_puestos.
  await admin.from('empleados_puestos').insert([
    { empleado_id: empMultiId, puesto_id: pstSoldadorId, consultora_id: cAId },
    { empleado_id: empMultiId, puesto_id: pstPintorId, consultora_id: cAId },
    { empleado_id: empFaltaId, puesto_id: pstSoldadorId, consultora_id: cAId },
    { empleado_id: empSinAgenteId, puesto_id: pstAdminId, consultora_id: cAId },
    { empleado_id: empArchivadoId, puesto_id: pstSoldadorId, consultora_id: cAId },
  ]);
});

afterAll(async () => {
  await admin
    .from('empleados_puestos')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('cliente_puesto_agentes')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('empleados')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('rar_agentes')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
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

describe('T-144 · listExpuestosByCliente', () => {
  it('lista solo expuestos activos (excluye sin-agente y archivado)', async () => {
    const { listExpuestosByCliente } = await import('@/app/(app)/rar/queries');
    const { expuestos } = await listExpuestosByCliente(clientOwnerA, clienteAId);
    const ids = expuestos.map((e) => e.empleado_id).sort();
    expect(ids).toEqual([empFaltaId, empMultiId].sort());
    expect(ids).not.toContain(empSinAgenteId);
    expect(ids).not.toContain(empArchivadoId);
  });

  it('empleado con 2 puestos hereda la unión SIN duplicar el agente compartido', async () => {
    const { listExpuestosByCliente } = await import('@/app/(app)/rar/queries');
    const { expuestos } = await listExpuestosByCliente(clientOwnerA, clienteAId);
    const multi = expuestos.find((e) => e.empleado_id === empMultiId);
    expect(multi).toBeDefined();
    const agenteIds = multi!.agentes.map((a) => a.agente_id).sort();
    expect(agenteIds).toEqual([agFisicoId, agQuimicoId].sort());
    expect(multi!.puestos).toHaveLength(2);
    expect(multi!.faltan_datos).toBe(false);
  });

  it('empleado sin CUIL/fecha_ingreso aparece marcado con faltan_datos', async () => {
    const { listExpuestosByCliente } = await import('@/app/(app)/rar/queries');
    const { expuestos } = await listExpuestosByCliente(clientOwnerA, clienteAId);
    const falta = expuestos.find((e) => e.empleado_id === empFaltaId);
    expect(falta).toBeDefined();
    expect(falta!.cuil).toBeNull();
    expect(falta!.fecha_ingreso).toBeNull();
    expect(falta!.faltan_datos).toBe(true);
    // hereda solo los agentes del soldador
    expect(falta!.agentes.map((a) => a.agente_id).sort()).toEqual([agFisicoId, agQuimicoId].sort());
  });

  it('set distinct de agentes del establecimiento (DAR)', async () => {
    const { listExpuestosByCliente } = await import('@/app/(app)/rar/queries');
    const { agentes } = await listExpuestosByCliente(clientOwnerA, clienteAId);
    expect(agentes.map((a) => a.agente_id).sort()).toEqual([agFisicoId, agQuimicoId].sort());
    // ordenado por tipo: fisico antes que quimico
    expect(agentes[0]!.agente_tipo).toBe('fisico');
    expect(agentes[1]!.agente_tipo).toBe('quimico');
  });

  it('cliente-scoping: un agente del mismo puesto en OTRO cliente NO se hereda (T-145)', async () => {
    const { listExpuestosByCliente } = await import('@/app/(app)/rar/queries');
    const { expuestos, agentes } = await listExpuestosByCliente(clientOwnerA, clienteAId);
    // agExtra está asignado al soldador SOLO en clienteOtro → no aparece en la
    // nómina ni en el DAR del cliente A, aunque empMulti/empFalta ocupan soldador.
    const todosLosAgentes = expuestos.flatMap((e) => e.agentes.map((a) => a.agente_id));
    expect(todosLosAgentes).not.toContain(agExtraId);
    expect(agentes.map((a) => a.agente_id)).not.toContain(agExtraId);
  });

  it('RLS cross-tenant: la consultora B ve nómina vacía del cliente de A', async () => {
    const { listExpuestosByCliente } = await import('@/app/(app)/rar/queries');
    const { expuestos, agentes } = await listExpuestosByCliente(clientOwnerB, clienteAId);
    expect(expuestos).toHaveLength(0);
    expect(agentes).toHaveLength(0);
  });
});
