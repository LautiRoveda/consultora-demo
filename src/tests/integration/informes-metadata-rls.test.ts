/**
 * T-021 · Tests cross-tenant + cascade de `public.informe_metadata`.
 *
 * Cobertura:
 * - RLS: SELECT/INSERT/UPDATE policies (EXISTS-subquery contra informes con
 *   helpers de T-015 + permission gate creator OR owner).
 * - ON DELETE CASCADE: borrar el informe parent borra la fila de metadata.
 *
 * Setup en linea con informes-rls.test.ts: 2 consultoras + 4 users + clientes
 * anon con session firmada via signInWithPassword.
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
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slugA = `t021-rls-a-${runId}`;
const slugB = `t021-rls-b-${runId}`;
const emailOwnerA = `t021-rls-owner-a-${runId}@example.com`;
const emailMemberA = `t021-rls-member-a-${runId}@example.com`;
const emailOwnerB = `t021-rls-owner-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let clientOwnerA: SupabaseClient<Database>;
let clientMemberA: SupabaseClient<Database>;
let clientOwnerB: SupabaseClient<Database>;

/** Informe en cA, creator=ownerA. Metadata insertada en beforeAll. */
let informeInCa: string;

const fixtureData = {
  razon_social: 'Test Fixture SA',
  cuit: '30-12345678-9',
  domicilio: 'Av. Test 100',
  localidad: 'CABA',
  provincia: 'CABA',
  actividad_principal: 'Test',
  cantidad_empleados: 10,
  distribucion_turno: 'unico',
  modalidad_operativa: 'comercial',
  art_contratada: 'Test ART',
  servicio_hys_modalidad: 'externo',
  areas_relevadas: ['Oficinas administrativas'],
  fecha_relevamiento: '2026-05-12',
};

beforeAll(async () => {
  // Consultoras.
  const [{ data: cA }, { data: cB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'T021 RLS cA', slug: slugA }).select('id').single(),
    admin.from('consultoras').insert({ name: 'T021 RLS cB', slug: slugB }).select('id').single(),
  ]);
  cAId = cA!.id;
  cBId = cB!.id;

  // Users.
  const [{ data: uOA }, { data: uMA }, { data: uOB }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailMemberA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true }),
  ]);
  ownerAId = uOA.user!.id;
  memberAId = uMA.user!.id;
  ownerBId = uOB.user!.id;

  // Memberships.
  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  // Claim JWT.
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  // Clientes anon con session firmada.
  const sbOA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbMA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbOB = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await Promise.all([
    sbOA.auth.signInWithPassword({ email: emailOwnerA, password }),
    sbMA.auth.signInWithPassword({ email: emailMemberA, password }),
    sbOB.auth.signInWithPassword({ email: emailOwnerB, password }),
  ]);
  clientOwnerA = sbOA;
  clientMemberA = sbMA;
  clientOwnerB = sbOB;

  // Informe parent + fila de metadata fixture.
  const { data: i } = await admin
    .from('informes')
    .insert({
      consultora_id: cAId,
      tipo: 'rgrl',
      titulo: 'T021 RLS fixture',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  informeInCa = i!.id;

  await admin.from('informe_metadata').insert({ informe_id: informeInCa, data: fixtureData });
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
  ]);
});

describe('informe_metadata RLS', () => {
  it('1. SELECT bloqueado para user de otra consultora', async () => {
    // ownerB es de cB; el informe metadata vive en cA.
    const { data } = await clientOwnerB
      .from('informe_metadata')
      .select('informe_id, data')
      .eq('informe_id', informeInCa)
      .maybeSingle();
    // RLS filtra → 0 rows, sin error (maybeSingle).
    expect(data).toBeNull();
  });

  it('1b. SELECT permitido para owner de la consultora del informe', async () => {
    const { data } = await clientOwnerA
      .from('informe_metadata')
      .select('informe_id, data')
      .eq('informe_id', informeInCa)
      .maybeSingle();
    expect(data?.informe_id).toBe(informeInCa);
  });

  it('2. INSERT bloqueado para member non-creator non-owner', async () => {
    // memberA es member de cA pero NO creator del informe (ownerA lo es).
    // Crear nuevo informe en cA para tener una metadata-row libre.
    const { data: nuevo } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'rgrl',
        titulo: 'T021 RLS INSERT test',
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const targetId = nuevo!.id;

    const { error } = await clientMemberA
      .from('informe_metadata')
      .insert({ informe_id: targetId, data: fixtureData });
    expect(error).not.toBeNull();
    // RLS violation: PG error code 42501 (insufficient_privilege) o new-row violates RLS.
    expect(error?.code).toMatch(/42501|^.{0,10}$/); // tolerante a versiones de pgrest
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('3. UPDATE bloqueado para user cross-tenant', async () => {
    const { data, error } = await clientOwnerB
      .from('informe_metadata')
      .update({ data: { ...fixtureData, razon_social: 'Hackeado' } })
      .eq('informe_id', informeInCa)
      .select('informe_id');
    // RLS USING filtra el row → 0 filas afectadas, sin error.
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    // Verificar que la data sigue siendo la original (no cambio).
    const { data: stillOriginal } = await admin
      .from('informe_metadata')
      .select('data')
      .eq('informe_id', informeInCa)
      .single();
    expect((stillOriginal?.data as Record<string, unknown>).razon_social).toBe('Test Fixture SA');
  });

  it('4. cascade: DELETE del informe parent borra la fila de metadata', async () => {
    // Crear pareja nueva informe + metadata, borrar el informe, verificar.
    const { data: nuevo } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'rgrl',
        titulo: 'T021 RLS cascade test',
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const targetId = nuevo!.id;

    await admin.from('informe_metadata').insert({ informe_id: targetId, data: fixtureData });

    const { data: before } = await admin
      .from('informe_metadata')
      .select('informe_id')
      .eq('informe_id', targetId)
      .maybeSingle();
    expect(before?.informe_id).toBe(targetId);

    // Hard delete del informe via service-role.
    await admin.from('informes').delete().eq('id', targetId);

    const { data: after } = await admin
      .from('informe_metadata')
      .select('informe_id')
      .eq('informe_id', targetId)
      .maybeSingle();
    expect(after).toBeNull();
  });
});
