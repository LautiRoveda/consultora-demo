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
