/**
 * T-062 · Tests RLS + audit + vista + constraints de `public.incidentes`.
 *
 * Cobertura:
 * - RLS: SELECT (any member) + INSERT (member, created_by=self, anti-spoof).
 * - Append-only: UPDATE y DELETE negados al rol authenticated (sin policy →
 *   0 rows, sin error). NO se testea RAISE EXCEPTION (no hay trigger duro).
 * - Constraints: uq_incidentes_corrige (doble corrección) + CHECK
 *   incidentes_gravedad_por_tipo.
 * - Audit: INSERT escribe audit_log con action created / corrected / annulled.
 * - Vista incidentes_vigentes: cadena A←B←C ⇒ solo C vigente; anulación oculta.
 * - Acción de sistema: borrar el informe referenciado ⇒ informe_id null + audit
 *   'updated' (FK on delete set null + branch UPDATE del trigger).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration src/tests/integration/accidentabilidad-rls.test.ts`.
 */
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestConsultora } from './helpers/consultora';

type IncidenteInsert = Database['public']['Tables']['incidentes']['Insert'];

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
const slugA = `t062-rls-a-${runId}`;
const slugB = `t062-rls-b-${runId}`;
const emailOwnerA = `t062-rls-owner-a-${runId}@example.com`;
const emailMemberA = `t062-rls-member-a-${runId}@example.com`;
const emailOwnerB = `t062-rls-owner-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let clientMemberA: SupabaseClient<Database>;
let clientAnon: SupabaseClient<Database>;

function makeIncidente(
  consultoraId: string,
  createdBy: string,
  overrides: Partial<IncidenteInsert> = {},
): IncidenteInsert {
  return {
    consultora_id: consultoraId,
    created_by: createdBy,
    tipo: 'casi_accidente',
    fecha: '2026-05-01',
    descripcion: 'Incidente de prueba para RLS/audit T-062.',
    ...overrides,
  };
}

async function insertIncidente(overrides: Partial<IncidenteInsert> = {}): Promise<string> {
  const { data, error } = await admin
    .from('incidentes')
    .insert(makeIncidente(cAId, ownerAId, overrides))
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertIncidente failed: ${JSON.stringify(error)}`);
  return data.id;
}

beforeAll(async () => {
  const cA = await createTestConsultora(admin, { name: 'T062 RLS cA', slug: slugA });
  cAId = cA.id;
  const cB = await createTestConsultora(admin, { name: 'T062 RLS cB', slug: slugB });
  cBId = cB.id;

  const uOA = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  if (uOA.error || !uOA.data.user)
    throw new Error(`createUser ownerA: ${JSON.stringify(uOA.error)}`);
  ownerAId = uOA.data.user.id;

  const uMA = await admin.auth.admin.createUser({
    email: emailMemberA,
    password,
    email_confirm: true,
  });
  if (uMA.error || !uMA.data.user)
    throw new Error(`createUser memberA: ${JSON.stringify(uMA.error)}`);
  memberAId = uMA.data.user.id;

  const uOB = await admin.auth.admin.createUser({
    email: emailOwnerB,
    password,
    email_confirm: true,
  });
  if (uOB.error || !uOB.data.user)
    throw new Error(`createUser ownerB: ${JSON.stringify(uOB.error)}`);
  ownerBId = uOB.data.user.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  const sbMA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await sbMA.auth.signInWithPassword({ email: emailMemberA, password });
  clientMemberA = sbMA;

  clientAnon = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
  ]);
});

describe('incidentes RLS · SELECT', () => {
  it('1. member de cA ve incidente de cA', async () => {
    const id = await insertIncidente();
    const { data, error } = await clientMemberA
      .from('incidentes')
      .select('id, tipo')
      .eq('id', id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(id);
  });

  it('2. member de cA NO ve incidente de cB (cross-tenant)', async () => {
    const { data: ins } = await admin
      .from('incidentes')
      .insert(makeIncidente(cBId, ownerBId))
      .select('id')
      .single();
    const { data, error } = await clientMemberA
      .from('incidentes')
      .select('id')
      .eq('id', ins!.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('3. anon NO ve incidentes (sin sesión) → 42501', async () => {
    const id = await insertIncidente();
    const { data, error } = await clientAnon
      .from('incidentes')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });
});

describe('incidentes RLS · INSERT', () => {
  it('4. member de cA inserta con consultora_id=cA + created_by=self', async () => {
    const { data, error } = await clientMemberA
      .from('incidentes')
      .insert(makeIncidente(cAId, memberAId))
      .select('id, consultora_id, created_by')
      .single();
    expect(error).toBeNull();
    expect(data?.consultora_id).toBe(cAId);
    expect(data?.created_by).toBe(memberAId);
  });

  it('5. member de cA NO puede insertar con consultora_id=cB', async () => {
    const { error } = await clientMemberA.from('incidentes').insert(makeIncidente(cBId, memberAId));
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('6. member de cA NO puede spoof created_by=otherUser', async () => {
    const { error } = await clientMemberA.from('incidentes').insert(makeIncidente(cAId, ownerBId));
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });
});

describe('incidentes RLS · UPDATE/DELETE negados (append-only)', () => {
  it('7. member de cA NO puede UPDATE (sin policy → 0 rows, sin error)', async () => {
    const id = await insertIncidente({ descripcion: 'Original append-only update test.' });
    const { data, error } = await clientMemberA
      .from('incidentes')
      .update({ descripcion: 'Mutado por el usuario (no debería).' })
      .eq('id', id)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    const { data: still } = await admin
      .from('incidentes')
      .select('descripcion')
      .eq('id', id)
      .single();
    expect(still?.descripcion).toBe('Original append-only update test.');
  });

  it('8. member de cA NO puede DELETE (sin policy → 0 rows, sin error)', async () => {
    const id = await insertIncidente();
    const { data, error } = await clientMemberA
      .from('incidentes')
      .delete()
      .eq('id', id)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    const { data: still } = await admin.from('incidentes').select('id').eq('id', id).maybeSingle();
    expect(still?.id).toBe(id);
  });
});

describe('incidentes · constraints', () => {
  it('9. uq_incidentes_corrige: doble corrección del mismo registro → 23505', async () => {
    const altaId = await insertIncidente();
    const { error: e1 } = await admin
      .from('incidentes')
      .insert(makeIncidente(cAId, ownerAId, { corrige_id: altaId }));
    expect(e1).toBeNull();

    const { error: e2 } = await admin
      .from('incidentes')
      .insert(makeIncidente(cAId, ownerAId, { corrige_id: altaId }));
    expect(e2).not.toBeNull();
    expect(e2?.code).toBe('23505');
  });

  it('10. CHECK gravedad_por_tipo: accidente SIN gravedad → 23514', async () => {
    const { error } = await admin
      .from('incidentes')
      .insert(makeIncidente(cAId, ownerAId, { tipo: 'accidente' }));
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
  });

  it('11. CHECK gravedad_por_tipo: casi_accidente CON gravedad → 23514', async () => {
    const { error } = await admin
      .from('incidentes')
      .insert(makeIncidente(cAId, ownerAId, { gravedad: 'leve' }));
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
  });
});

describe('incidentes · audit_log', () => {
  async function auditAction(entityId: string): Promise<string | null> {
    const { data } = await admin
      .from('audit_log')
      .select('action')
      .eq('entity_type', 'incidentes')
      .eq('entity_id', entityId)
      .maybeSingle();
    return data?.action ?? null;
  }

  it('12. INSERT alta → audit action="created"', async () => {
    const id = await insertIncidente();
    expect(await auditAction(id)).toBe('created');
  });

  it('13. INSERT corrección (corrige_id) → audit action="corrected"', async () => {
    const altaId = await insertIncidente();
    const { data: corr } = await admin
      .from('incidentes')
      .insert(makeIncidente(cAId, ownerAId, { corrige_id: altaId }))
      .select('id')
      .single();
    expect(await auditAction(corr!.id)).toBe('corrected');
  });

  it('14. INSERT anulación (anulacion=true) → audit action="annulled"', async () => {
    const altaId = await insertIncidente();
    const { data: anul } = await admin
      .from('incidentes')
      .insert(makeIncidente(cAId, ownerAId, { corrige_id: altaId, anulacion: true }))
      .select('id')
      .single();
    expect(await auditAction(anul!.id)).toBe('annulled');
  });
});

describe('incidentes_vigentes (vista)', () => {
  it('15. cadena A←B←C ⇒ solo C vigente; anulación oculta la cadena', async () => {
    const aId = await insertIncidente({ descripcion: 'Cadena A — alta original.' });
    const { data: b } = await admin
      .from('incidentes')
      .insert(
        makeIncidente(cAId, ownerAId, { corrige_id: aId, descripcion: 'Cadena B corrige A.' }),
      )
      .select('id')
      .single();
    const { data: c } = await admin
      .from('incidentes')
      .insert(
        makeIncidente(cAId, ownerAId, { corrige_id: b!.id, descripcion: 'Cadena C corrige B.' }),
      )
      .select('id')
      .single();

    // memberA consulta la vista (security_invoker → RLS de cA aplica).
    const { data: vigentes, error } = await clientMemberA
      .from('incidentes_vigentes')
      .select('id')
      .in('id', [aId, b!.id, c!.id]);
    expect(error).toBeNull();
    expect((vigentes ?? []).map((r) => r.id)).toEqual([c!.id]);

    // Cadena anulada: D (alta) ← E (anula D) ⇒ ninguno vigente.
    const dId = await insertIncidente({ descripcion: 'Cadena D — alta a anular.' });
    const { data: e } = await admin
      .from('incidentes')
      .insert(makeIncidente(cAId, ownerAId, { corrige_id: dId, anulacion: true }))
      .select('id')
      .single();
    const { data: vigentesDE } = await clientMemberA
      .from('incidentes_vigentes')
      .select('id')
      .in('id', [dId, e!.id]);
    expect(vigentesDE ?? []).toEqual([]);
  });
});

describe('incidentes_heads (vista — T-063-FU2: anulados incluidos)', () => {
  it('17. anulado aparece en heads pero NO en vigentes; superseded en ninguna', async () => {
    // Cadena: alta F ← corrección G ← tombstone H (anula G).
    const fId = await insertIncidente({ descripcion: 'Heads F — alta.' });
    const { data: g } = await admin
      .from('incidentes')
      .insert(makeIncidente(cAId, ownerAId, { corrige_id: fId, descripcion: 'Heads G corrige F.' }))
      .select('id')
      .single();
    const { data: h } = await admin
      .from('incidentes')
      .insert(makeIncidente(cAId, ownerAId, { corrige_id: g!.id, anulacion: true }))
      .select('id')
      .single();

    const { data: heads, error: headsErr } = await clientMemberA
      .from('incidentes_heads')
      .select('id, anulacion')
      .in('id', [fId, g!.id, h!.id]);
    expect(headsErr).toBeNull();
    // Head de la cadena = el tombstone H (nadie lo supersede), con anulacion=true.
    expect((heads ?? []).map((r) => r.id)).toEqual([h!.id]);
    expect(heads?.[0]?.anulacion).toBe(true);

    // En vigentes no aparece ninguno (la cadena está anulada).
    const { data: vigentes } = await clientMemberA
      .from('incidentes_vigentes')
      .select('id')
      .in('id', [fId, g!.id, h!.id]);
    expect(vigentes ?? []).toEqual([]);
  });

  it('18. heads respeta RLS: member de cA NO ve heads de cB (cross-tenant)', async () => {
    const { data: ins } = await admin
      .from('incidentes')
      .insert(makeIncidente(cBId, ownerBId))
      .select('id')
      .single();
    const { data, error } = await clientMemberA
      .from('incidentes_heads')
      .select('id')
      .eq('id', ins!.id);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});

describe('link_informe_to_incidente (RPC — T-075: UPDATE acotado)', () => {
  async function insertAccidente(overrides: Partial<IncidenteInsert> = {}): Promise<string> {
    return insertIncidente({ tipo: 'accidente', gravedad: 'grave', ...overrides });
  }

  async function insertInformeCA(): Promise<string> {
    const { data, error } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'accidente',
        titulo: `T075 informe ${runId} ${Math.random().toString(36).slice(2, 7)}`,
        created_by: ownerAId,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`insertInformeCA failed: ${JSON.stringify(error)}`);
    return data.id;
  }

  it('19. happy: member linkea accidente↔informe → informe_id seteado + audit "linked"', async () => {
    const incId = await insertAccidente();
    const infId = await insertInformeCA();

    const { error } = await clientMemberA.rpc('link_informe_to_incidente', {
      p_incidente_id: incId,
      p_informe_id: infId,
    });
    expect(error).toBeNull();

    const { data: after } = await admin
      .from('incidentes')
      .select('informe_id')
      .eq('id', incId)
      .single();
    expect(after?.informe_id).toBe(infId);

    const { data: audit } = await admin
      .from('audit_log')
      .select('action')
      .eq('entity_type', 'incidentes')
      .eq('entity_id', incId)
      .eq('action', 'linked')
      .maybeSingle();
    expect(audit?.action).toBe('linked');
  });

  it('20. append-only intacto: UPDATE directo de informe_id sigue 0 filas (RPC no aflojó RLS)', async () => {
    const incId = await insertAccidente();
    const infId = await insertInformeCA();
    const { data, error } = await clientMemberA
      .from('incidentes')
      .update({ informe_id: infId })
      .eq('id', incId)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    const { data: still } = await admin
      .from('incidentes')
      .select('informe_id')
      .eq('id', incId)
      .single();
    expect(still?.informe_id).toBeNull();
  });

  it('21. ya vinculado: segundo link del mismo incidente → 23505 (idempotencia)', async () => {
    const incId = await insertAccidente();
    const infId = await insertInformeCA();
    const { error: e1 } = await clientMemberA.rpc('link_informe_to_incidente', {
      p_incidente_id: incId,
      p_informe_id: infId,
    });
    expect(e1).toBeNull();

    const infId2 = await insertInformeCA();
    const { error: e2 } = await clientMemberA.rpc('link_informe_to_incidente', {
      p_incidente_id: incId,
      p_informe_id: infId2,
    });
    expect(e2?.code).toBe('23505');
  });

  it('22. cross-tenant: member de cA NO puede linkear incidente de cB → 42501', async () => {
    const { data: incB } = await admin
      .from('incidentes')
      .insert(makeIncidente(cBId, ownerBId, { tipo: 'accidente', gravedad: 'grave' }))
      .select('id')
      .single();
    const infId = await insertInformeCA();
    const { error } = await clientMemberA.rpc('link_informe_to_incidente', {
      p_incidente_id: incB!.id,
      p_informe_id: infId,
    });
    expect(error?.code).toBe('42501');
  });

  it('23. tipo casi_accidente → 23514 (solo accidente se investiga)', async () => {
    const incId = await insertIncidente(); // casi_accidente por defecto
    const infId = await insertInformeCA();
    const { error } = await clientMemberA.rpc('link_informe_to_incidente', {
      p_incidente_id: incId,
      p_informe_id: infId,
    });
    expect(error?.code).toBe('23514');
  });

  it('24. registro superseded (corregido) → 23514 (solo el vigente)', async () => {
    const altaId = await insertAccidente({ descripcion: 'T075 alta a corregir.' });
    await admin.from('incidentes').insert(
      makeIncidente(cAId, ownerAId, {
        tipo: 'accidente',
        gravedad: 'grave',
        corrige_id: altaId,
        descripcion: 'T075 corrige.',
      }),
    );
    const infId = await insertInformeCA();
    const { error } = await clientMemberA.rpc('link_informe_to_incidente', {
      p_incidente_id: altaId,
      p_informe_id: infId,
    });
    expect(error?.code).toBe('23514');
  });
});

describe('incidentes · acción de sistema (FK set-null + audit updated)', () => {
  it('16. borrar el informe referenciado ⇒ informe_id null + audit "updated"', async () => {
    const { data: informe } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'accidente',
        titulo: `T062 informe link ${runId}`,
        created_by: ownerAId,
      })
      .select('id')
      .single();

    const incidenteId = await insertIncidente({ informe_id: informe!.id });

    const { error: delErr } = await admin.from('informes').delete().eq('id', informe!.id);
    expect(delErr).toBeNull();

    const { data: after } = await admin
      .from('incidentes')
      .select('informe_id')
      .eq('id', incidenteId)
      .single();
    expect(after?.informe_id).toBeNull();

    const { data: auditUpdated } = await admin
      .from('audit_log')
      .select('action, after_data')
      .eq('entity_type', 'incidentes')
      .eq('entity_id', incidenteId)
      .eq('action', 'updated')
      .maybeSingle();
    expect(auditUpdated?.action).toBe('updated');
    expect(
      (auditUpdated?.after_data as { informe_id?: string | null } | null)?.informe_id,
    ).toBeNull();
  });
});
