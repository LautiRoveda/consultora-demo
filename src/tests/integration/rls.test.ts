/**
 * T-011 · Tests cross-tenant del schema RLS multi-tenant.
 *
 * Estos tests hablan con el Supabase REMOTO (sa-east-1). NO corren en CI
 * (decisión T-011 #8 — developer discipline pre-PR). Local only.
 *
 * Setup: 2 consultoras + 2 users + 2 memberships + app_metadata.consultora_id
 * inyectado vía admin.auth.admin.updateUserById (simula lo que hará el Auth Hook
 * de T-016). Sign-in via signInWithPassword para obtener un JWT con la claim.
 *
 * Cleanup: borra users (cascada limpia memberships). Las consultoras + audit_log
 * quedan orphan porque el trigger inmutable del audit_log impide DELETE incluso
 * desde service-role. Usar slugs únicos por run para evitar colisiones — limpieza
 * manual periódica vía SQL Editor (ver supabase/README.md).
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
    'Tests de integración requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY en el environment.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slugA = `t011-test-a-${runId}`;
const slugB = `t011-test-b-${runId}`;
const emailA = `t011-test-a-${runId}@example.com`;
const emailB = `t011-test-b-${runId}@example.com`;
const password = 'TestPassword123!';

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let cAId: string;
let cBId: string;
let userAId: string;
let userBId: string;
let auditAId: string;
let clientA: SupabaseClient<Database>;
let clientB: SupabaseClient<Database>;

beforeAll(async () => {
  // 1. Crear 2 consultoras (service-role bypasa RLS).
  const [{ data: cA, error: ecA }, { data: cB, error: ecB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'Test Consultora A', slug: slugA }).select().single(),
    admin.from('consultoras').insert({ name: 'Test Consultora B', slug: slugB }).select().single(),
  ]);
  if (ecA || !cA) throw new Error(`crear consultora A falló: ${ecA?.message}`);
  if (ecB || !cB) throw new Error(`crear consultora B falló: ${ecB?.message}`);
  cAId = cA.id;
  cBId = cB.id;

  // 2. Crear 2 users con auth.admin (email_confirm: true para skip de verificación).
  const [{ data: uA, error: euA }, { data: uB, error: euB }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailB, password, email_confirm: true }),
  ]);
  if (euA || !uA.user) throw new Error(`crear user A falló: ${euA?.message}`);
  if (euB || !uB.user) throw new Error(`crear user B falló: ${euB?.message}`);
  userAId = uA.user.id;
  userBId = uB.user.id;

  // 3. Crear memberships.
  const { error: emErr } = await admin.from('consultora_members').insert([
    { user_id: userAId, consultora_id: cAId, role: 'owner' },
    { user_id: userBId, consultora_id: cBId, role: 'owner' },
  ]);
  if (emErr) throw new Error(`crear memberships falló: ${emErr.message}`);

  // 4. Setear custom claim app_metadata.consultora_id (simula T-016 Auth Hook).
  const [{ error: emaA }, { error: emaB }] = await Promise.all([
    admin.auth.admin.updateUserById(userAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(userBId, { app_metadata: { consultora_id: cBId } }),
  ]);
  if (emaA) throw new Error(`set app_metadata A falló: ${emaA.message}`);
  if (emaB) throw new Error(`set app_metadata B falló: ${emaB.message}`);

  // 5. Insertar 1 audit_log row por consultora (para validar SELECT policy + immutable).
  const { data: audit, error: eAudit } = await admin
    .from('audit_log')
    .insert([
      { consultora_id: cAId, action: 'test_setup', actor_user_id: userAId },
      { consultora_id: cBId, action: 'test_setup', actor_user_id: userBId },
    ])
    .select('id, consultora_id');
  if (eAudit || !audit) throw new Error(`insert audit_log falló: ${eAudit?.message}`);
  const aRow = audit.find((r) => r.consultora_id === cAId);
  if (!aRow) throw new Error('no se encontró audit row de consultora A');
  auditAId = aRow.id;

  // 6. Sign-in para obtener JWTs CON la claim recién seteada.
  const sbA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbB = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const [{ error: esA }, { error: esB }] = await Promise.all([
    sbA.auth.signInWithPassword({ email: emailA, password }),
    sbB.auth.signInWithPassword({ email: emailB, password }),
  ]);
  if (esA) throw new Error(`sign in A falló: ${esA.message}`);
  if (esB) throw new Error(`sign in B falló: ${esB.message}`);
  clientA = sbA;
  clientB = sbB;
});

afterAll(async () => {
  // Borrar users (cascada limpia consultora_members). Consultoras + audit_log
  // quedan orphan por el trigger inmutable — limpieza manual periódica.
  if (userAId) await admin.auth.admin.deleteUser(userAId);
  if (userBId) await admin.auth.admin.deleteUser(userBId);
});

describe('RLS: consultoras', () => {
  it('userA ve SU consultora (cA)', async () => {
    const { data, error } = await clientA.from('consultoras').select('*').eq('id', cAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.slug).toBe(slugA);
  });

  it('userA NO ve la consultora de otro tenant (cB)', async () => {
    const { data, error } = await clientA.from('consultoras').select('*').eq('id', cBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('userA NO puede INSERT en consultoras (sin policy)', async () => {
    const { data, error } = await clientA
      .from('consultoras')
      .insert({ name: 'Pwned', slug: `pwned-${runId}` })
      .select();
    // RLS sin policy de INSERT → error (Postgres devuelve "new row violates RLS").
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('userA NO puede UPDATE consultora de otro tenant (cB)', async () => {
    const { data, error } = await clientA
      .from('consultoras')
      .update({ name: 'Hackeada' })
      .eq('id', cBId)
      .select();
    // Sin error explícito pero 0 rows afectadas (RLS filtra antes del UPDATE).
    expect(error).toBeNull();
    expect(data).toEqual([]);
    // Verificar que cB no cambió.
    const { data: check } = await admin.from('consultoras').select('name').eq('id', cBId).single();
    expect(check?.name).toBe('Test Consultora B');
  });
});

describe('RLS: consultora_members', () => {
  it('userA ve solo memberships de su consultora', async () => {
    const { data, error } = await clientA.from('consultora_members').select('*');
    expect(error).toBeNull();
    expect(data?.every((m) => m.consultora_id === cAId)).toBe(true);
  });

  it('userA NO ve memberships de otro tenant', async () => {
    const { data, error } = await clientA
      .from('consultora_members')
      .select('*')
      .eq('consultora_id', cBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('userA ve SU propia membership via consultora_members_select_self (defensiva pre-T-016)', async () => {
    const { data, error } = await clientA
      .from('consultora_members')
      .select('*')
      .eq('user_id', userAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.consultora_id).toBe(cAId);
    expect(data?.[0]?.role).toBe('owner');
  });
});

describe('RLS: audit_log', () => {
  it('userA ve audit_log solo de su consultora', async () => {
    const { data, error } = await clientA.from('audit_log').select('*');
    expect(error).toBeNull();
    expect(data?.every((r) => r.consultora_id === cAId)).toBe(true);
  });

  it('userA NO ve audit_log de otro tenant', async () => {
    const { data, error } = await clientA.from('audit_log').select('*').eq('consultora_id', cBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('userB ve audit_log solo de SU consultora (isolation simétrica)', async () => {
    const { data, error } = await clientB.from('audit_log').select('*');
    expect(error).toBeNull();
    expect(data?.every((r) => r.consultora_id === cBId)).toBe(true);
  });
});

describe('audit_log: immutability trigger', () => {
  it('UPDATE en audit_log desde service-role tira por trigger inmutable', async () => {
    const { error } = await admin
      .from('audit_log')
      .update({ action: 'tampered' })
      .eq('id', auditAId);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/inmutable|UPDATE/i);
  });

  it('DELETE en audit_log desde service-role tira por trigger inmutable', async () => {
    const { error } = await admin.from('audit_log').delete().eq('id', auditAId);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/inmutable|DELETE/i);
  });
});

describe('service-role bypass', () => {
  it('service-role ve TODAS las consultoras (bypasa RLS)', async () => {
    const { data, error } = await admin.from('consultoras').select('id').in('id', [cAId, cBId]);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });
});
