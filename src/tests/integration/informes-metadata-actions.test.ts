/**
 * T-021 · Tests de `updateInformeMetadataAction`.
 * T-022 · Wrap del payload a discriminated union {tipo, data} + parametrizacion
 *         describe.each() para los 4 tipos nuevos (capacitacion, relevamiento,
 *         accidente, otros) cubriendo happy path UPSERT + tipo mismatch.
 *
 * Cubre los paths criticos del discriminated union + el contrato con el
 * trigger `audit_informe_metadata`:
 *   1. INVALID_INPUT — Zod falla (CUIT con regex no matcheado).
 *   2. UNAUTHENTICATED — sin session cookie.
 *   3. NOT_FOUND — informeId que no existe.
 *   4. FORBIDDEN — member que NO es creator NI owner.
 *   5. happy path UPSERT + audit_log con before/after data.
 *   6. (T-022) tipo mismatch input vs informe → INVALID_INPUT _.
 *   7-10. (T-022) happy path UPSERT por cada uno de los 4 tipos nuevos.
 *
 * Setup heredado de informes-content-actions.test.ts: 2 consultoras (A, B)
 * + 3 users (ownerA, memberA, ownerB). RGRL fixture valida en `validRgrl`.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import type { AccidenteMetadata } from '@/shared/templates/accidente/schema';
import type { CapacitacionMetadata } from '@/shared/templates/capacitacion/schema';
import type { OtrosMetadata } from '@/shared/templates/otros/schema';
import type { RelevamientoMetadata } from '@/shared/templates/relevamiento/schema';
import type { RgrlMetadata } from '@/shared/templates/rgrl/schema';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
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
};

// T-022 · Fixtures por tipo, completos en obligatorios.
const validCapacitacion: CapacitacionMetadata = {
  razon_social: 'Construcciones del Plata SA',
  cuit: '30-98765432-1',
  domicilio: 'Av. Mitre 567',
  fecha_capacitacion: '2026-05-12',
  modalidad: 'presencial',
  duracion_horas: 2,
  tema_principal: 'Uso correcto de EPP en altura',
  capacitador_nombre: 'Juan Pérez',
  cantidad_asistentes_prevista: 25,
};

const validRelevamiento: RelevamientoMetadata = {
  razon_social: 'Frigorífico del Sur SRL',
  cuit: '30-11122233-4',
  domicilio: 'Ruta 8 Km 47',
  localidad: 'Pilar',
  provincia: 'BA',
  fecha_relevamiento: '2026-05-10',
  areas_relevadas: ['Producción / planta', 'Sala de máquinas'],
  agentes_a_relevar: ['ruido', 'carga_termica'],
};

const validAccidente: AccidenteMetadata = {
  razon_social: 'Talleres Metalúrgicos SA',
  cuit: '30-55566677-8',
  domicilio: 'Calle 9 de Julio 1500',
  fecha_accidente: '2026-05-11',
  hora_accidente: '14:30',
  lugar_especifico: 'Línea de prensa, sector B',
  puesto_afectado: 'Operario de prensa',
  tipo_lesion: ['herida_cortante'],
  partes_cuerpo_afectadas: ['manos'],
  gravedad: 'grave',
  testigos_presentes: true,
  descripcion_inicial: 'Operario sufrió corte en mano derecha al retirar guarda de seguridad.',
};

const validOtros: OtrosMetadata = {
  razon_social: 'Inmobiliaria Pampa SRL',
  cuit: '30-77788899-0',
  tema_informe: 'Auditoría interna de sistema HyS',
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

describe('updateInformeMetadataAction · RGRL', () => {
  it('1. INVALID_INPUT cuando CUIT no matchea el regex', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');
    const bad: RgrlMetadata = { ...validRgrl, cuit: 'no-es-cuit' };
    const result = await updateInformeMetadataAction(informeOwnerAInCa, {
      tipo: 'rgrl',
      data: bad,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_INPUT');
    if (result.code !== 'INVALID_INPUT') throw new Error('unreachable');
    // T-022: fieldErrors viene con keys sin el prefijo `data.` (stripeado en el action).
    expect(result.fieldErrors.cuit?.[0]).toMatch(/CUIT/i);
  });

  it('2. UNAUTHENTICATED sin session cookie', async () => {
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');
    const result = await updateInformeMetadataAction(informeOwnerAInCa, {
      tipo: 'rgrl',
      data: validRgrl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('3. NOT_FOUND cuando informeId no existe', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const result = await updateInformeMetadataAction(fakeId, { tipo: 'rgrl', data: validRgrl });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('NOT_FOUND');
  });

  it('4. FORBIDDEN cuando user es member pero NO creator NI owner', async () => {
    await signInAs(emailMemberA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');
    const result = await updateInformeMetadataAction(informeOwnerAInCa, {
      tipo: 'rgrl',
      data: validRgrl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('FORBIDDEN');
  });

  it('5. happy path UPSERT (insert + update) + audit_log con before/after', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');

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
    const r1 = await updateInformeMetadataAction(targetId, { tipo: 'rgrl', data: validRgrl });
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

    // Audit log INSERT.
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
    const r2 = await updateInformeMetadataAction(targetId, { tipo: 'rgrl', data: modified });
    expect(r2.ok).toBe(true);

    const { data: row2 } = await admin
      .from('informe_metadata')
      .select('data')
      .eq('informe_id', targetId)
      .single();
    expect((row2?.data as Record<string, unknown>).razon_social).toBe('Metalúrgica Sur SRL');

    // Audit log UPDATE.
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

// =============================================================================
// T-022 · Discriminated union + 4 tipos nuevos
// =============================================================================

describe('updateInformeMetadataAction · T-022 discriminated union', () => {
  it('6. INVALID_INPUT cuando input.tipo no coincide con informe.tipo', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');

    // Crear un informe tipo='rgrl' y mandarle payload con tipo='capacitacion'.
    const { data: nuevo } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'rgrl',
        titulo: 'Mismatch tipo test',
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const targetId = nuevo!.id;

    const result = await updateInformeMetadataAction(targetId, {
      tipo: 'capacitacion',
      data: validCapacitacion,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_INPUT');
    if (result.code !== 'INVALID_INPUT') throw new Error('unreachable');
    expect(result.fieldErrors._?.[0]).toMatch(/tipo/i);
  });
});

// Happy path UPSERT por cada tipo nuevo (4 tests parametrizados).
type TipoFixture =
  | { tipo: 'capacitacion'; data: CapacitacionMetadata }
  | { tipo: 'relevamiento'; data: RelevamientoMetadata }
  | { tipo: 'accidente'; data: AccidenteMetadata }
  | { tipo: 'otros'; data: OtrosMetadata };

const tipoFixtures: TipoFixture[] = [
  { tipo: 'capacitacion', data: validCapacitacion },
  { tipo: 'relevamiento', data: validRelevamiento },
  { tipo: 'accidente', data: validAccidente },
  { tipo: 'otros', data: validOtros },
];

describe.each(tipoFixtures)(
  'updateInformeMetadataAction · T-022 happy path tipo=$tipo',
  ({ tipo, data }) => {
    it(`UPSERT + audit_log para tipo=${tipo}`, async () => {
      await signInAs(emailOwnerA);
      const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');

      const { data: nuevo } = await admin
        .from('informes')
        .insert({
          consultora_id: cAId,
          tipo,
          titulo: `T-022 ${tipo} UPSERT test`,
          created_by: ownerAId,
        })
        .select('id')
        .single();
      const targetId = nuevo!.id;

      // Discriminated union: el fixture es narrowed por iteracion.
      const result = await updateInformeMetadataAction(targetId, { tipo, data });
      expect(result.ok).toBe(true);

      const { data: row } = await admin
        .from('informe_metadata')
        .select('data')
        .eq('informe_id', targetId)
        .single();
      expect(row?.data).toMatchObject({
        razon_social: data.razon_social,
        cuit: data.cuit,
      });

      const { data: audit } = await admin
        .from('audit_log')
        .select('action, after_data')
        .eq('entity_id', targetId)
        .eq('entity_type', 'informe_metadata')
        .eq('action', 'created')
        .single();
      expect(audit?.action).toBe('created');
      const after = audit?.after_data as Record<string, unknown> | null;
      expect(after?.data_size_bytes).toBeGreaterThan(0);
    });
  },
);

// =============================================================================
// T-138 fase 1 · Personalizacion (campos_personalizados + instrucciones)
// =============================================================================

describe('updateInformeMetadataAction · T-138 personalizacion', () => {
  async function createInforme(tipo: 'rgrl' | 'relevamiento', titulo: string): Promise<string> {
    const { data: nuevo } = await admin
      .from('informes')
      .insert({ consultora_id: cAId, tipo, titulo, created_by: ownerAId })
      .select('id')
      .single();
    return nuevo!.id;
  }

  it('7. UPSERT persiste la personalizacion; [] y "" se normalizan fuera del jsonb', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');
    const targetId = await createInforme('rgrl', 'T-138 personalizacion UPSERT');

    // Con valores: persisten.
    const r1 = await updateInformeMetadataAction(targetId, {
      tipo: 'rgrl',
      data: {
        ...validRgrl,
        campos_personalizados: [{ label: 'N° de contrato ART', valor: '887766' }],
        instrucciones_adicionales: 'priorizá el plan de mejoras por costo',
      },
    });
    expect(r1.ok).toBe(true);

    const { data: row1 } = await admin
      .from('informe_metadata')
      .select('data')
      .eq('informe_id', targetId)
      .single();
    const data1 = row1?.data as Record<string, unknown>;
    expect(data1.campos_personalizados).toEqual([{ label: 'N° de contrato ART', valor: '887766' }]);
    expect(data1.instrucciones_adicionales).toBe('priorizá el plan de mejoras por costo');

    // Vacios (defaults RHF): normalize los dropea → el jsonb queda lean,
    // identico al de un informe pre-T-138.
    const r2 = await updateInformeMetadataAction(targetId, {
      tipo: 'rgrl',
      data: { ...validRgrl, campos_personalizados: [], instrucciones_adicionales: '' },
    });
    expect(r2.ok).toBe(true);

    const { data: row2 } = await admin
      .from('informe_metadata')
      .select('data')
      .eq('informe_id', targetId)
      .single();
    const data2 = row2?.data as Record<string, unknown>;
    expect('campos_personalizados' in data2).toBe(false);
    expect('instrucciones_adicionales' in data2).toBe(false);
  });

  it('8. INVALID_INPUT con campos_personalizados sobre el cap (10)', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');
    const targetId = await createInforme('relevamiento', 'T-138 cap test');

    const result = await updateInformeMetadataAction(targetId, {
      tipo: 'relevamiento',
      data: {
        ...validRelevamiento,
        campos_personalizados: Array.from({ length: 11 }, () => ({ label: 'L', valor: 'v' })),
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_INPUT');
  });

  it('9. payload pre-T-138 (sin campos de personalizacion) sigue siendo valido', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeMetadataAction } = await import('@/app/(app)/informes/[id]/actions');
    const targetId = await createInforme('rgrl', 'T-138 backward-compat payload');

    const result = await updateInformeMetadataAction(targetId, { tipo: 'rgrl', data: validRgrl });
    expect(result.ok).toBe(true);
  });
});
