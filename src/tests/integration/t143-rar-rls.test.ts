/**
 * T-143 · RLS cross-tenant de `rar_agentes` y `puesto_agentes`.
 *
 * Cobertura (helpers T-015 is_member_of_consultora):
 * - rar_agentes: SELECT aislado por tenant; INSERT cross-tenant bloqueado;
 *   INSERT con created_by != auth.uid() bloqueado; INSERT propio OK.
 * - cliente_puesto_agentes: SELECT aislado por tenant; INSERT cross-tenant
 *   bloqueado (exposición por establecimiento, T-145).
 *
 * clientes anon con session firmada (RLS real, NO service-role). Claim JWT
 * (T-016 fast-path). Molde calendar-events-rls.test.ts.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
const slugA = `t143-rls-a-${runId}`;
const slugB = `t143-rls-b-${runId}`;
const emailOwnerA = `t143-rls-own-a-${runId}@example.com`;
const emailOwnerB = `t143-rls-own-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let clientOwnerA: SupabaseClient<Database>;
let clientOwnerB: SupabaseClient<Database>;

let agenteAId: string;
let puestoAId: string;
let clienteAId: string;

beforeAll(async () => {
  const { data: cA } = await admin
    .from('consultoras')
    .insert({ name: 'T143 RLS cA', slug: slugA })
    .select('id')
    .single();
  cAId = cA!.id;
  const { data: cB } = await admin
    .from('consultoras')
    .insert({ name: 'T143 RLS cB', slug: slugB })
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

  const sbOA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbOB = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await sbOA.auth.signInWithPassword({ email: emailOwnerA, password });
  await sbOB.auth.signInWithPassword({ email: emailOwnerB, password });
  clientOwnerA = sbOA;
  clientOwnerB = sbOB;

  // Fixtures en cA via admin: agente + puesto + asignación.
  const { data: ag } = await admin
    .from('rar_agentes')
    .insert({
      consultora_id: cAId,
      codigo: `RA-${runId}`,
      nombre: `Ruido ${runId}`,
      agente_tipo: 'fisico',
    })
    .select('id')
    .single();
  agenteAId = ag!.id;

  const { data: pst } = await admin
    .from('puestos')
    .insert({ consultora_id: cAId, nombre: `Soldador ${runId}` })
    .select('id')
    .single();
  puestoAId = pst!.id;

  const cuitBase = Date.now().toString().slice(-8).padStart(8, '0');
  const { data: cli } = await admin
    .from('clientes')
    .insert({ consultora_id: cAId, razon_social: `Cliente RLS ${runId}`, cuit: `30-${cuitBase}-5` })
    .select('id')
    .single();
  clienteAId = cli!.id;

  await admin
    .from('cliente_puesto_agentes')
    .insert({
      cliente_id: clienteAId,
      puesto_id: puestoAId,
      agente_id: agenteAId,
      consultora_id: cAId,
    });
});

afterAll(async () => {
  await admin
    .from('cliente_puesto_agentes')
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

describe('T-143 · RLS rar_agentes', () => {
  it('ownerA ve su agente', async () => {
    const { data } = await clientOwnerA
      .from('rar_agentes')
      .select('id')
      .eq('id', agenteAId)
      .maybeSingle();
    expect(data?.id).toBe(agenteAId);
  });

  it('ownerB NO ve el agente de A (cross-tenant)', async () => {
    const { data } = await clientOwnerB
      .from('rar_agentes')
      .select('id')
      .eq('id', agenteAId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('ownerB NO puede insertar agente en la consultora A', async () => {
    const { error } = await clientOwnerB.from('rar_agentes').insert({
      consultora_id: cAId,
      codigo: `RA-HACK-${runId}`,
      nombre: 'Cross tenant',
      agente_tipo: 'fisico',
      created_by: ownerBId,
    });
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('ownerA NO puede insertar agente con created_by != auth.uid()', async () => {
    const { error } = await clientOwnerA.from('rar_agentes').insert({
      consultora_id: cAId,
      codigo: `RA-SPOOF-${runId}`,
      nombre: 'Spoof',
      agente_tipo: 'fisico',
      created_by: ownerBId,
    });
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('ownerA inserta agente propio (consultora A, created_by = auth.uid()) OK', async () => {
    const { error } = await clientOwnerA.from('rar_agentes').insert({
      consultora_id: cAId,
      codigo: `RA-OK-${runId}`,
      nombre: 'Agente propio',
      agente_tipo: 'quimico',
      created_by: ownerAId,
    });
    expect(error).toBeNull();
  });
});

describe('T-145 · RLS cliente_puesto_agentes', () => {
  it('ownerA ve la asignación de su tenant', async () => {
    const { data } = await clientOwnerA
      .from('cliente_puesto_agentes')
      .select('cliente_id, puesto_id, agente_id')
      .eq('puesto_id', puestoAId);
    expect(data?.length ?? 0).toBe(1);
  });

  it('ownerB NO ve asignaciones del tenant A (cross-tenant)', async () => {
    const { data } = await clientOwnerB
      .from('cliente_puesto_agentes')
      .select('puesto_id')
      .eq('puesto_id', puestoAId);
    expect(data?.length ?? 0).toBe(0);
  });

  it('ownerB NO puede insertar asignación en la consultora A', async () => {
    const { error } = await clientOwnerB.from('cliente_puesto_agentes').insert({
      cliente_id: clienteAId,
      puesto_id: puestoAId,
      agente_id: agenteAId,
      consultora_id: cAId,
      asignado_por: ownerBId,
    });
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });
});
