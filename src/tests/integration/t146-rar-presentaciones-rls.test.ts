/**
 * T-146 · RLS + integridad de `rar_presentaciones` y del tipo `rar_anual`.
 *
 * Cobertura (helpers T-015 is_member_of_consultora):
 *  - rar_presentaciones: SELECT aislado por tenant (member ve la suya, otro no);
 *    INSERT por authenticated bloqueado (tabla inmutable, SIN policy INSERT).
 *  - Ring A: las 2 FK compuestas (cliente / calendar_event) rechazan referencias
 *    cross-tenant aunque el INSERT sea service-role.
 *  - calendar_events.tipo = 'rar_anual': aceptado por el CHECK (insert admin);
 *    rechazado a authenticated por la policy calendar_events_insert_own.
 *
 * clientes anon con session firmada (RLS real). Molde t143-rar-rls.test.ts.
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
const slugA = `t146-rls-a-${runId}`;
const slugB = `t146-rls-b-${runId}`;
const emailOwnerA = `t146-rls-own-a-${runId}@example.com`;
const emailOwnerB = `t146-rls-own-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let clientOwnerA: SupabaseClient<Database>;
let clientOwnerB: SupabaseClient<Database>;

let clienteAId: string;
let clienteBId: string;
let eventAId: string;
let presentacionAId: string;

const SNAPSHOT = { cliente: { razon_social: 'X' }, nomina: { expuestos: [], agentes: [] } };

beforeAll(async () => {
  const { data: cA } = await admin
    .from('consultoras')
    .insert({ name: 'T146 RLS cA', slug: slugA })
    .select('id')
    .single();
  cAId = cA!.id;
  const { data: cB } = await admin
    .from('consultoras')
    .insert({ name: 'T146 RLS cB', slug: slugB })
    .select('id')
    .single();
  cBId = cB!.id;

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

  // Clientes en cada tenant.
  const cuitA = Date.now().toString().slice(-8).padStart(8, '0');
  const { data: clA } = await admin
    .from('clientes')
    .insert({ consultora_id: cAId, razon_social: `Cliente A ${runId}`, cuit: `30-${cuitA}-5` })
    .select('id')
    .single();
  clienteAId = clA!.id;
  const cuitB = (Date.now() + 1).toString().slice(-8).padStart(8, '0');
  const { data: clB } = await admin
    .from('clientes')
    .insert({ consultora_id: cBId, razon_social: `Cliente B ${runId}`, cuit: `30-${cuitB}-6` })
    .select('id')
    .single();
  clienteBId = clB!.id;

  // Evento rar_anual de cA (insert admin: el CHECK lo acepta) → para Ring A + linkage.
  const { data: ev, error: evErr } = await admin
    .from('calendar_events')
    .insert({
      consultora_id: cAId,
      tipo: 'rar_anual',
      titulo: `Vencimiento RAR — Cliente A ${runId}`,
      fecha_vencimiento: '2027-01-01',
      reminder_offsets_days: [60, 30, 7, 0],
      status: 'pending',
      created_by: ownerAId,
      metadata: { cliente_id: clienteAId, source_module: 'rar' },
    })
    .select('id')
    .single();
  expect(evErr).toBeNull();
  eventAId = ev!.id;

  // Presentación de cA (insert admin: la tabla NO tiene policy INSERT).
  const { data: pres, error: presErr } = await admin
    .from('rar_presentaciones')
    .insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      periodo: 2026,
      fecha_vencimiento: '2027-01-01',
      snapshot: SNAPSHOT,
      calendar_event_id: eventAId,
      created_by: ownerAId,
    })
    .select('id')
    .single();
  expect(presErr).toBeNull();
  presentacionAId = pres!.id;
});

afterAll(async () => {
  const ids = [cAId, cBId];
  await admin
    .from('rar_presentaciones')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('calendar_events')
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
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
});

describe('T-146 · RLS rar_presentaciones', () => {
  it('ownerA ve su presentación', async () => {
    const { data } = await clientOwnerA
      .from('rar_presentaciones')
      .select('id, periodo')
      .eq('id', presentacionAId)
      .maybeSingle();
    expect(data?.id).toBe(presentacionAId);
    expect(data?.periodo).toBe(2026);
  });

  it('ownerB NO ve la presentación de A (cross-tenant)', async () => {
    const { data } = await clientOwnerB
      .from('rar_presentaciones')
      .select('id')
      .eq('id', presentacionAId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('authenticated NO puede insertar (tabla inmutable, sin policy INSERT)', async () => {
    const { error } = await clientOwnerA.from('rar_presentaciones').insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      periodo: 2030,
      fecha_vencimiento: '2031-01-01',
      snapshot: SNAPSHOT,
      created_by: ownerAId,
    });
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });
});

describe('T-146 · Ring A rar_presentaciones (FK compuestas)', () => {
  it('rechaza un cliente de otra consultora (cpa cliente FK)', async () => {
    const { error } = await admin.from('rar_presentaciones').insert({
      consultora_id: cAId,
      cliente_id: clienteBId, // de cB → (clienteB, cA) no existe en clientes(id, consultora_id)
      periodo: 2026,
      fecha_vencimiento: '2027-01-01',
      snapshot: SNAPSHOT,
      created_by: ownerAId,
    });
    expect(error?.message.toLowerCase()).toMatch(/foreign key|violates/);
  });

  it('rechaza un calendar_event de otra consultora (calevent FK)', async () => {
    // Evento en cB.
    const { data: evB } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cBId,
        tipo: 'rar_anual',
        titulo: `RAR B ${runId}`,
        fecha_vencimiento: '2027-01-01',
        reminder_offsets_days: [60, 30, 7, 0],
        status: 'pending',
        created_by: ownerBId,
        metadata: { cliente_id: clienteBId, source_module: 'rar' },
      })
      .select('id')
      .single();

    const { error } = await admin.from('rar_presentaciones').insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      periodo: 2028,
      fecha_vencimiento: '2029-01-01',
      snapshot: SNAPSHOT,
      calendar_event_id: evB!.id, // (evB, cA) no existe → FK compuesta falla
      created_by: ownerAId,
    });
    expect(error?.message.toLowerCase()).toMatch(/foreign key|violates/);
  });
});

describe('T-146 · calendar_events tipo rar_anual', () => {
  it('el CHECK acepta rar_anual (insert admin OK)', async () => {
    const { error } = await admin.from('calendar_events').insert({
      consultora_id: cAId,
      tipo: 'rar_anual',
      titulo: `RAR check ${runId}`,
      fecha_vencimiento: '2027-06-01',
      reminder_offsets_days: [60, 30, 7, 0],
      status: 'pending',
      created_by: ownerAId,
      metadata: { cliente_id: clienteAId, source_module: 'rar' },
    });
    expect(error).toBeNull();
  });

  it('la policy bloquea el INSERT de rar_anual a authenticated', async () => {
    const { error } = await clientOwnerA.from('calendar_events').insert({
      consultora_id: cAId,
      tipo: 'rar_anual',
      titulo: `RAR hack ${runId}`,
      fecha_vencimiento: '2027-06-01',
      reminder_offsets_days: [60, 30, 7, 0],
      status: 'pending',
      created_by: ownerAId,
    });
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });
});
