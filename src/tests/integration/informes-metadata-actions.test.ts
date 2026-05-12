/**
 * T-021 · Tests de `updateInformeMetadataAction`.
 *
 * Cubre los paths criticos del discriminated union + el contrato con el
 * trigger `audit_informe_metadata`:
 *   1. INVALID_INPUT — Zod falla (CUIT con regex no matcheado).
 *   2. UNAUTHENTICATED — sin session cookie.
 *   3. NOT_FOUND — informeId que no existe.
 *   4. FORBIDDEN — member que NO es creator NI owner.
 *   5. happy path UPSERT + audit_log con before/after data.
 *
 * Setup heredado de informes-content-actions.test.ts: 2 consultoras (A, B)
 * + 3 users (ownerA, memberA, ownerB). RGRL fixture valida en `validRgrl`.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import type { RgrlMetadata } from '@/shared/templates/rgrl/schema';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => cookieStore.map((c) => ({ name: c.name, value: c.value })),
      set: (name: string, value: string) => {
        const idx = cookieStore.findIndex((c) => c.name === name);
        if (idx >= 0) cookieStore[idx] = { name, value };
        else cookieStore.push({ name, value });
      },
    }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

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
const password = 'TestPassword123!';

const slugA = `t021-ma-ca-${runId}`;
const emailOwnerA = `t021-ma-owner-a-${runId}@example.com`;
const emailMemberA = `t021-ma-member-a-${runId}@example.com`;

let cAId: string;
let ownerAId: string;
let memberAId: string;
let informeOwnerAInCa: string;

/** Fixture RGRL valido — cubre todos los obligatorios + omite 2 opcionales. */
const validRgrl: RgrlMetadata = {
  razon_social: 'Metalúrgica del Sur SA',
  cuit: '30-12345678-9',
  domicilio: 'Av. Industrial 1234',
  localidad: 'Tigre',
  provincia: 'BA',
  actividad_principal: 'Fabricación de estructuras metálicas',
  cantidad_empleados: 80,
  distribucion_turno: 'doble',
  modalidad_operativa: 'industrial',
  art_contratada: 'La Segunda',
  servicio_hys_modalidad: 'externo',
  areas_relevadas: [
    'Oficinas administrativas',
    'Producción / planta',
    'Depósito / almacén',
    'Mantenimiento / taller',
    'Servicios generales (comedor, sanitarios)',
  ],
  fecha_relevamiento: '2026-05-12',
  // codigo_ciiu, riesgos_pre_detectados → omitidos (opcionales)
};

beforeAll(async () => {
  const { data: cA } = await admin
    .from('consultoras')
    .insert({ name: 'T021 Metadata Actions cA', slug: slugA })
    .select('id')
    .single();
  cAId = cA!.id;

  const [{ data: uOA }, { data: uMA }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailMemberA, password, email_confirm: true }),
  ]);
  ownerAId = uOA.user!.id;
  memberAId = uMA.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
  ]);

  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
  ]);

  // Informe RGRL creado por ownerA (no por memberA — clave para el test FORBIDDEN).
  const { data: i } = await admin
    .from('informes')
    .insert({
      consultora_id: cAId,
      tipo: 'rgrl',
      titulo: 'Informe metadata actions test',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  informeOwnerAInCa = i!.id;
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
  ]);
});

beforeEach(() => {
  cookieStore.length = 0;
});

/**
 * Cache por email: el primer signin hace `signInWithPassword`; los siguientes
 * restauran los cookies snapshot. Mitiga `over_request_rate_limit` (30/hr).
 */
const sessionCache = new Map<string, Array<{ name: string; value: string }>>();

async function signInAs(email: string): Promise<void> {
  cookieStore.length = 0;
  const cached = sessionCache.get(email);
  if (cached) {
    for (const c of cached) cookieStore.push({ ...c });
    return;
  }
  const { createClient: createServerClient } = await import('@/shared/supabase/server');
  const sb = await createServerClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  sessionCache.set(
    email,
    cookieStore.map((c) => ({ ...c })),
  );
}

describe('updateInformeMetadataAction', () => {
  it('1. INVALID_INPUT cuando CUIT no matchea el regex', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');
    const bad = { ...validRgrl, cuit: 'no-es-cuit' };
    const result = await updateInformeMetadataAction(informeOwnerAInCa, bad);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_INPUT');
    if (result.code !== 'INVALID_INPUT') throw new Error('unreachable');
    expect(result.fieldErrors.cuit?.[0]).toMatch(/CUIT/i);
  });

  it('2. UNAUTHENTICATED sin session cookie', async () => {
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');
    const result = await updateInformeMetadataAction(informeOwnerAInCa, validRgrl);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('3. NOT_FOUND cuando informeId no existe', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const result = await updateInformeMetadataAction(fakeId, validRgrl);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('NOT_FOUND');
  });

  it('4. FORBIDDEN cuando user es member pero NO creator NI owner', async () => {
    // memberA es member de cA pero NO creator del informe (ownerA lo es) NI owner.
    await signInAs(emailMemberA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');
    const result = await updateInformeMetadataAction(informeOwnerAInCa, validRgrl);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('FORBIDDEN');
  });

  it('5. happy path UPSERT (insert + update) + audit_log con before/after', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');

    // Crear informe NUEVO para este test (cleanup aislado).
    const { data: nuevo } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'rgrl',
        titulo: 'Metadata UPSERT test',
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const targetId = nuevo!.id;

    // 1er call → INSERT.
    const r1 = await updateInformeMetadataAction(targetId, validRgrl);
    expect(r1.ok).toBe(true);

    const { data: row1 } = await admin
      .from('informe_metadata')
      .select('data')
      .eq('informe_id', targetId)
      .single();
    expect(row1?.data).toMatchObject({
      razon_social: 'Metalúrgica del Sur SA',
      cuit: '30-12345678-9',
      cantidad_empleados: 80,
      provincia: 'BA',
    });

    // Audit log INSERT: before_data null, after_data con el payload.
    const { data: auditInsert } = await admin
      .from('audit_log')
      .select('action, before_data, after_data')
      .eq('entity_id', targetId)
      .eq('entity_type', 'informe_metadata')
      .eq('action', 'created')
      .single();
    expect(auditInsert?.action).toBe('created');
    expect(auditInsert?.before_data).toBeNull();
    const afterInsert = auditInsert?.after_data as Record<string, unknown> | null;
    expect(afterInsert?.data_size_bytes).toBeGreaterThan(0);
    expect((afterInsert?.data as Record<string, unknown>).razon_social).toBe(
      'Metalúrgica del Sur SA',
    );

    // 2do call con cambio → UPDATE.
    const modified: RgrlMetadata = { ...validRgrl, razon_social: 'Metalúrgica Sur SRL' };
    const r2 = await updateInformeMetadataAction(targetId, modified);
    expect(r2.ok).toBe(true);

    const { data: row2 } = await admin
      .from('informe_metadata')
      .select('data')
      .eq('informe_id', targetId)
      .single();
    expect((row2?.data as Record<string, unknown>).razon_social).toBe('Metalúrgica Sur SRL');

    // Audit log UPDATE: before/after distintos en razon_social.
    const { data: auditUpdate } = await admin
      .from('audit_log')
      .select('action, before_data, after_data')
      .eq('entity_id', targetId)
      .eq('entity_type', 'informe_metadata')
      .eq('action', 'updated')
      .single();
    expect(auditUpdate?.action).toBe('updated');
    const beforeUpd = auditUpdate?.before_data as Record<string, unknown> | null;
    const afterUpd = auditUpdate?.after_data as Record<string, unknown> | null;
    expect((beforeUpd?.data as Record<string, unknown>).razon_social).toBe(
      'Metalúrgica del Sur SA',
    );
    expect((afterUpd?.data as Record<string, unknown>).razon_social).toBe('Metalúrgica Sur SRL');
  });
});
