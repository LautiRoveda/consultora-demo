/**
 * T-019 · Tests cross-tenant del modulo Informes.
 *
 * Cobertura:
 * - RLS: SELECT/INSERT/UPDATE/DELETE policies de `public.informes`.
 * - Audit triggers AFTER INSERT/UPDATE/DELETE: escriben a `public.audit_log`
 *   con shape correcto (action, entity_type, before_data/after_data).
 * - Check constraints (tipo, status, titulo length).
 *
 * Setup similar a rls.test.ts (T-011/T-015): 2 consultoras + 4 users con
 * claim app_metadata.consultora_id. Cleanup borra users; consultoras y
 * audit_log quedan orphan (audit trigger inmutable bloquea DELETE).
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
    'Tests de integracion requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY en el environment.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slugA = `t019-test-a-${runId}`;
const slugB = `t019-test-b-${runId}`;
const emailOwnerA = `t019-test-owner-a-${runId}@example.com`;
const emailMemberA = `t019-test-member-a-${runId}@example.com`;
const emailOwnerB = `t019-test-owner-b-${runId}@example.com`;
const emailOutsider = `t019-test-outsider-${runId}@example.com`;
const password = 'TestPassword123!';

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let outsiderId: string;
let clientOwnerA: SupabaseClient<Database>;
let clientMemberA: SupabaseClient<Database>;
let clientOwnerB: SupabaseClient<Database>;
let clientOutsider: SupabaseClient<Database>;

beforeAll(async () => {
  // 1. Crear 2 consultoras.
  const [{ data: cA, error: ecA }, { data: cB, error: ecB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'T019 Consultora A', slug: slugA }).select().single(),
    admin.from('consultoras').insert({ name: 'T019 Consultora B', slug: slugB }).select().single(),
  ]);
  if (ecA || !cA) throw new Error(`crear cA fallo: ${ecA?.message}`);
  if (ecB || !cB) throw new Error(`crear cB fallo: ${ecB?.message}`);
  cAId = cA.id;
  cBId = cB.id;

  // 2. Crear 4 users.
  //    - ownerA: owner de cA
  //    - memberA: member (no-owner) de cA
  //    - ownerB: owner de cB
  //    - outsider: sin membership
  const [{ data: uOA }, { data: uMA }, { data: uOB }, { data: uOut }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailMemberA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailOutsider, password, email_confirm: true }),
  ]);
  ownerAId = uOA.user!.id;
  memberAId = uMA.user!.id;
  ownerBId = uOB.user!.id;
  outsiderId = uOut.user!.id;

  // 3. Memberships.
  const { error: emErr } = await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);
  if (emErr) throw new Error(`crear memberships fallo: ${emErr.message}`);

  // 4. Claim app_metadata.consultora_id en JWT (simula auth hook T-016).
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  // 5. Sign-in para obtener JWTs frescos con el claim.
  const sbOA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbMA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbOB = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbOut = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await Promise.all([
    sbOA.auth.signInWithPassword({ email: emailOwnerA, password }),
    sbMA.auth.signInWithPassword({ email: emailMemberA, password }),
    sbOB.auth.signInWithPassword({ email: emailOwnerB, password }),
    sbOut.auth.signInWithPassword({ email: emailOutsider, password }),
  ]);
  clientOwnerA = sbOA;
  clientMemberA = sbMA;
  clientOwnerB = sbOB;
  clientOutsider = sbOut;
});

afterAll(async () => {
  // Borrar users (cascade limpia memberships e informes via FK on delete cascade
  // de consultora_id; informes apuntan a consultora, no a user con cascade).
  // Importante: los informes que cuelgan de cA/cB se borran via cascade cuando
  // borremos las consultoras... pero no las borramos (audit_log las pinea con
  // on delete restrict). Quedan orphan.
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId),
    admin.auth.admin.deleteUser(memberAId),
    admin.auth.admin.deleteUser(ownerBId),
    admin.auth.admin.deleteUser(outsiderId),
  ]);
});

describe('T-019 RLS: informes SELECT', () => {
  let informeAId: string;

  beforeAll(async () => {
    // Insertar 1 informe en cA y 1 en cB con service-role (bypasa RLS).
    const { data, error } = await admin
      .from('informes')
      .insert([
        { consultora_id: cAId, tipo: 'rgrl', titulo: 'Informe RGRL cA', created_by: ownerAId },
        {
          consultora_id: cBId,
          tipo: 'capacitacion',
          titulo: 'Informe Capa cB',
          created_by: ownerBId,
        },
      ])
      .select('id, consultora_id');
    if (error || !data) throw new Error(`insert informes fallo: ${error?.message}`);
    informeAId = data.find((r) => r.consultora_id === cAId)!.id;
  });

  it('memberA ve los informes de su consultora (cA)', async () => {
    const { data, error } = await clientMemberA.from('informes').select('*');
    expect(error).toBeNull();
    expect(data?.some((r) => r.id === informeAId)).toBe(true);
    expect(data?.every((r) => r.consultora_id === cAId)).toBe(true);
  });

  it('memberA NO ve informes de otra consultora (cB)', async () => {
    const { data, error } = await clientMemberA
      .from('informes')
      .select('*')
      .eq('consultora_id', cBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('outsider (sin membership) NO ve ningun informe', async () => {
    const { data, error } = await clientOutsider.from('informes').select('*');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe('T-019 RLS: informes INSERT', () => {
  it('memberA puede INSERT en cA atribuido a si mismo', async () => {
    const { data, error } = await clientMemberA
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'relevamiento',
        titulo: 'Insert por memberA',
        created_by: memberAId,
      })
      .select('id, created_by')
      .single();
    expect(error).toBeNull();
    expect(data?.created_by).toBe(memberAId);
  });

  it('memberA NO puede INSERT en cB (cross-tenant)', async () => {
    const { error } = await clientMemberA.from('informes').insert({
      consultora_id: cBId,
      tipo: 'otros',
      titulo: 'Pwn cross tenant',
      created_by: memberAId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/row-level security|violates/i);
  });

  it('memberA NO puede INSERT con created_by ajeno (RLS with check bloquea)', async () => {
    const { error } = await clientMemberA.from('informes').insert({
      consultora_id: cAId,
      tipo: 'otros',
      titulo: 'Spoof created_by',
      created_by: ownerAId, // != memberA.id → with check falla
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/row-level security|violates/i);
  });

  it('outsider NO puede INSERT en ninguna consultora', async () => {
    const { error } = await clientOutsider.from('informes').insert({
      consultora_id: cAId,
      tipo: 'otros',
      titulo: 'Outsider try',
      created_by: outsiderId,
    });
    expect(error).not.toBeNull();
  });
});

describe('T-019 RLS: informes UPDATE', () => {
  let memberInformeId: string;
  let ownerInformeId: string;

  beforeAll(async () => {
    // 1 informe creado por memberA, 1 creado por ownerA.
    const { data: m } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'otros',
        titulo: 'Original member',
        created_by: memberAId,
      })
      .select('id')
      .single();
    memberInformeId = m!.id;

    const { data: o } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'otros',
        titulo: 'Original owner',
        created_by: ownerAId,
      })
      .select('id')
      .single();
    ownerInformeId = o!.id;
  });

  it('memberA puede UPDATE su propio informe', async () => {
    const { data, error } = await clientMemberA
      .from('informes')
      .update({ titulo: 'Editado por memberA' })
      .eq('id', memberInformeId)
      .select('titulo')
      .single();
    expect(error).toBeNull();
    expect(data?.titulo).toBe('Editado por memberA');
  });

  it('memberA NO puede UPDATE informe de otro user (ownerA) en su misma consultora', async () => {
    const { data, error } = await clientMemberA
      .from('informes')
      .update({ titulo: 'Hack owner' })
      .eq('id', ownerInformeId)
      .select();
    // RLS filtra antes del UPDATE → 0 rows afectadas, sin error.
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const { data: check } = await admin
      .from('informes')
      .select('titulo')
      .eq('id', ownerInformeId)
      .single();
    expect(check?.titulo).toBe('Original owner');
  });

  it('ownerA puede UPDATE cualquier informe de SU consultora (incluso de memberA)', async () => {
    const { data, error } = await clientOwnerA
      .from('informes')
      .update({ titulo: 'Editado por owner' })
      .eq('id', memberInformeId)
      .select('titulo')
      .single();
    expect(error).toBeNull();
    expect(data?.titulo).toBe('Editado por owner');
  });

  it('ownerB NO puede UPDATE informes de otra consultora (cA)', async () => {
    const { data, error } = await clientOwnerB
      .from('informes')
      .update({ titulo: 'Hack cross tenant' })
      .eq('id', ownerInformeId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('trigger set_updated_at mueve updated_at en UPDATE', async () => {
    const { data: before } = await admin
      .from('informes')
      .select('updated_at')
      .eq('id', memberInformeId)
      .single();
    await new Promise((r) => setTimeout(r, 50));
    await admin.from('informes').update({ titulo: 'Touch updated_at' }).eq('id', memberInformeId);
    const { data: after } = await admin
      .from('informes')
      .select('updated_at')
      .eq('id', memberInformeId)
      .single();
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(
      new Date(before!.updated_at).getTime(),
    );
  });
});

describe('T-019 RLS: informes DELETE (default-deny)', () => {
  let informeId: string;

  beforeAll(async () => {
    const { data } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'otros',
        titulo: 'Delete target',
        created_by: memberAId,
      })
      .select('id')
      .single();
    informeId = data!.id;
  });

  it('memberA (creator) NO puede DELETE su propio informe (sin policy)', async () => {
    const { data, error } = await clientMemberA
      .from('informes')
      .delete()
      .eq('id', informeId)
      .select();
    // Sin policy DELETE → RLS filtra → 0 rows afectadas, sin error.
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const { data: check } = await admin
      .from('informes')
      .select('id')
      .eq('id', informeId)
      .maybeSingle();
    expect(check?.id).toBe(informeId);
  });

  it('ownerA NO puede DELETE informes de su consultora (sin policy)', async () => {
    const { data, error } = await clientOwnerA
      .from('informes')
      .delete()
      .eq('id', informeId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe('T-019 audit triggers: informes → audit_log', () => {
  it('INSERT crea audit row con action=created y after_data poblado', async () => {
    const titulo = `Audit insert ${runId}`;
    const { data: informe } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'rgrl',
        titulo,
        created_by: memberAId,
      })
      .select('id')
      .single();

    const { data: audit } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, before_data, after_data, consultora_id')
      .eq('entity_id', informe!.id)
      .eq('action', 'created')
      .single();

    expect(audit?.action).toBe('created');
    expect(audit?.entity_type).toBe('informes');
    expect(audit?.consultora_id).toBe(cAId);
    expect(audit?.before_data).toBeNull();
    // T-020: payload extendido con contenido_size + contenido_preview.
    expect(audit?.after_data).toEqual({
      tipo: 'rgrl',
      titulo,
      status: 'draft',
      cliente_id: null,
      contenido_size: 0,
      contenido_preview: null,
    });
  });

  it('UPDATE con cambio auditable crea audit row con before/after data', async () => {
    const { data: informe } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'otros',
        titulo: 'Antes update',
        created_by: memberAId,
      })
      .select('id')
      .single();

    await admin.from('informes').update({ titulo: 'Despues update' }).eq('id', informe!.id);

    const { data: audit } = await admin
      .from('audit_log')
      .select('action, before_data, after_data')
      .eq('entity_id', informe!.id)
      .eq('action', 'updated')
      .single();

    expect(audit?.action).toBe('updated');
    expect(audit?.before_data).toEqual({
      tipo: 'otros',
      titulo: 'Antes update',
      status: 'draft',
      cliente_id: null,
      contenido_size: 0,
      contenido_preview: null,
    });
    expect(audit?.after_data).toEqual({
      tipo: 'otros',
      titulo: 'Despues update',
      status: 'draft',
      cliente_id: null,
      contenido_size: 0,
      contenido_preview: null,
    });
  });

  it('UPDATE sin cambio en ningun campo auditable NO crea audit row (diff guard)', async () => {
    const { data: informe } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'otros',
        titulo: 'No-op target',
        created_by: memberAId,
      })
      .select('id')
      .single();

    // T-020: contenido ahora ES auditable. Para validar el diff guard, hacemos
    // un UPDATE que re-setea titulo al mismo valor — ningun campo auditable
    // cambia, `is distinct from` da false, trigger no inserta row.
    await admin.from('informes').update({ titulo: 'No-op target' }).eq('id', informe!.id);

    const { count } = await admin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', informe!.id)
      .eq('action', 'updated');
    expect(count).toBe(0);
  });

  it('DELETE (service-role) crea audit row con action=deleted y before_data poblado', async () => {
    const { data: informe } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'accidente',
        titulo: 'Para borrar',
        created_by: memberAId,
      })
      .select('id')
      .single();

    const { error: delErr } = await admin.from('informes').delete().eq('id', informe!.id);
    expect(delErr).toBeNull();

    const { data: audit } = await admin
      .from('audit_log')
      .select('action, before_data, after_data, entity_type, consultora_id')
      .eq('entity_id', informe!.id)
      .eq('action', 'deleted')
      .single();

    expect(audit?.action).toBe('deleted');
    expect(audit?.entity_type).toBe('informes');
    expect(audit?.consultora_id).toBe(cAId);
    expect(audit?.before_data).toEqual({
      tipo: 'accidente',
      titulo: 'Para borrar',
      status: 'draft',
      cliente_id: null,
      contenido_size: 0,
      contenido_preview: null,
    });
    expect(audit?.after_data).toBeNull();
  });
});

describe('T-019 check constraints', () => {
  it('tipo fuera de la lista permitida es rechazado por DB', async () => {
    const { error } = await admin.from('informes').insert({
      consultora_id: cAId,
      tipo: 'tipo_invalido',
      titulo: 'Bad tipo',
      created_by: ownerAId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/check constraint|tipo/i);
  });

  it('status fuera de la lista permitida es rechazado por DB', async () => {
    const { error } = await admin.from('informes').insert({
      consultora_id: cAId,
      tipo: 'otros',
      titulo: 'Bad status',
      status: 'invalid_status',
      created_by: ownerAId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/check constraint|status/i);
  });

  it('titulo demasiado corto es rechazado por DB', async () => {
    const { error } = await admin.from('informes').insert({
      consultora_id: cAId,
      tipo: 'otros',
      titulo: 'ab',
      created_by: ownerAId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/check constraint|titulo/i);
  });
});
