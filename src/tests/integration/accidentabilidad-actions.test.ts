/**
 * T-062 · Tests de integration de las server actions del módulo Accidentabilidad.
 *
 * Cobertura:
 *  - registerIncidenteAction: happy casi_accidente + happy accidente (gravedad +
 *    dias_perdidos + cliente_id/empleado_id de cA) + INVALID_INPUT (accidente sin
 *    gravedad, fecha futura) + UNAUTHENTICATED + NO_CONSULTORA + audit 'created'.
 *  - CROSS_TENANT_REF: cliente_id / empleado_id / informe_id de OTRO tenant.
 *  - corregirIncidenteAction: happy (corrected) + ALREADY_CORRECTED (doble).
 *  - anularIncidenteAction: happy (tombstone anulacion=true) + sale de la vista.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration src/tests/integration/accidentabilidad-actions.test.ts`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestConsultora } from './helpers/consultora';

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
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  },
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
const slugA = `t062a-${runId}`;
const slugB = `t062b-${runId}`;
const emailOwnerA = `t062a-own-${runId}@example.com`;
const emailMemberA = `t062a-mem-${runId}@example.com`;
const emailOwnerB = `t062b-own-${runId}@example.com`;
const emailNoConsul = `t062-nocon-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let noConsulId: string;

// Fixtures FK.
let clienteAId: string;
let empleadoAId: string;
let clienteBId: string;
let empleadoBId: string;
let informeBId: string;

let cuitCounter = 20000000;
function nextCuit(): string {
  cuitCounter += 1;
  return `30-${cuitCounter.toString().padStart(8, '0')}-9`;
}

const PAST_DATE = '2026-05-01'; // currentDate del proyecto = 2026-06-02 → pasada.

beforeAll(async () => {
  const cA = await createTestConsultora(admin, { name: 'T062A', slug: slugA });
  cAId = cA.id;
  const cB = await createTestConsultora(admin, { name: 'T062B', slug: slugB });
  cBId = cB.id;

  const uOA = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  ownerAId = uOA.data.user!.id;
  const uMA = await admin.auth.admin.createUser({
    email: emailMemberA,
    password,
    email_confirm: true,
  });
  memberAId = uMA.data.user!.id;
  const uOB = await admin.auth.admin.createUser({
    email: emailOwnerB,
    password,
    email_confirm: true,
  });
  ownerBId = uOB.data.user!.id;
  const uNc = await admin.auth.admin.createUser({
    email: emailNoConsul,
    password,
    email_confirm: true,
  });
  noConsulId = uNc.data.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } });

  // Fixtures: cliente + empleado en cada tenant + informe en cB.
  const cliA = await admin
    .from('clientes')
    .insert({
      consultora_id: cAId,
      razon_social: 'T062 Cliente A',
      cuit: nextCuit(),
      created_by: ownerAId,
    })
    .select('id')
    .single();
  clienteAId = cliA.data!.id;

  const empA = await admin
    .from('empleados')
    .insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'Juan',
      apellido: 'Pérez',
      dni: '30111222',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  empleadoAId = empA.data!.id;

  const cliB = await admin
    .from('clientes')
    .insert({
      consultora_id: cBId,
      razon_social: 'T062 Cliente B',
      cuit: nextCuit(),
      created_by: ownerBId,
    })
    .select('id')
    .single();
  clienteBId = cliB.data!.id;

  const empB = await admin
    .from('empleados')
    .insert({
      consultora_id: cBId,
      cliente_id: clienteBId,
      nombre: 'Ana',
      apellido: 'Gómez',
      dni: '30111333',
      created_by: ownerBId,
    })
    .select('id')
    .single();
  empleadoBId = empB.data!.id;

  const infB = await admin
    .from('informes')
    .insert({
      consultora_id: cBId,
      tipo: 'accidente',
      titulo: 'T062 Informe B',
      created_by: ownerBId,
    })
    .select('id')
    .single();
  informeBId = infB.data!.id;
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(memberAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
  await admin.auth.admin.deleteUser(noConsulId).catch(() => {});
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

const baseCasi = {
  tipo: 'casi_accidente',
  fecha: PAST_DATE,
  descripcion: 'Casi-accidente de prueba T-062.',
};
const baseAccidente = {
  tipo: 'accidente',
  fecha: PAST_DATE,
  descripcion: 'Accidente con lesión de prueba T-062.',
  gravedad: 'grave',
  dias_perdidos: 5,
};

describe('registerIncidenteAction', () => {
  it('1. happy casi_accidente → ok + row consultora_id=cA, created_by=member, anulacion=false', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction } = await import('@/app/(app)/accidentabilidad/actions');
    const r = await registerIncidenteAction(baseCasi);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { data: row } = await admin
      .from('incidentes')
      .select('consultora_id, created_by, tipo, anulacion, corrige_id')
      .eq('id', r.incidenteId)
      .single();
    expect(row).toMatchObject({
      consultora_id: cAId,
      created_by: memberAId,
      tipo: 'casi_accidente',
      anulacion: false,
      corrige_id: null,
    });

    const { data: audit } = await admin
      .from('audit_log')
      .select('action')
      .eq('entity_type', 'incidentes')
      .eq('entity_id', r.incidenteId)
      .maybeSingle();
    expect(audit?.action).toBe('created');
  });

  it('2. happy accidente con gravedad + dias_perdidos + cliente_id/empleado_id de cA', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction } = await import('@/app/(app)/accidentabilidad/actions');
    const r = await registerIncidenteAction({
      ...baseAccidente,
      cliente_id: clienteAId,
      empleado_id: empleadoAId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { data: row } = await admin
      .from('incidentes')
      .select('tipo, gravedad, dias_perdidos, cliente_id, empleado_id')
      .eq('id', r.incidenteId)
      .single();
    expect(row).toMatchObject({
      tipo: 'accidente',
      gravedad: 'grave',
      dias_perdidos: 5,
      cliente_id: clienteAId,
      empleado_id: empleadoAId,
    });
  });

  it('3. INVALID_INPUT: accidente sin gravedad → fieldErrors.gravedad', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction } = await import('@/app/(app)/accidentabilidad/actions');
    const { gravedad, ...sinGravedad } = baseAccidente;
    void gravedad;
    const r = await registerIncidenteAction(sinGravedad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
    if (r.code !== 'INVALID_INPUT') return;
    expect(r.fieldErrors.gravedad?.length ?? 0).toBeGreaterThan(0);
  });

  it('4. INVALID_INPUT: fecha futura', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction } = await import('@/app/(app)/accidentabilidad/actions');
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 5);
    const r = await registerIncidenteAction({
      ...baseCasi,
      fecha: future.toISOString().slice(0, 10),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('5. UNAUTHENTICATED sin sesión', async () => {
    cookieStore.length = 0;
    const { registerIncidenteAction } = await import('@/app/(app)/accidentabilidad/actions');
    const r = await registerIncidenteAction(baseCasi);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('UNAUTHENTICATED');
  });

  it('6. NO_CONSULTORA user huérfano', async () => {
    await signInAs(emailNoConsul);
    const { registerIncidenteAction } = await import('@/app/(app)/accidentabilidad/actions');
    const r = await registerIncidenteAction(baseCasi);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NO_CONSULTORA');
  });
});

describe('registerIncidenteAction · CROSS_TENANT_REF', () => {
  it('7. cliente_id de otro tenant → CROSS_TENANT_REF', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction } = await import('@/app/(app)/accidentabilidad/actions');
    const r = await registerIncidenteAction({ ...baseCasi, cliente_id: clienteBId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('CROSS_TENANT_REF');
  });

  it('8. empleado_id de otro tenant → CROSS_TENANT_REF', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction } = await import('@/app/(app)/accidentabilidad/actions');
    const r = await registerIncidenteAction({ ...baseCasi, empleado_id: empleadoBId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('CROSS_TENANT_REF');
  });

  it('9. informe_id de otro tenant → CROSS_TENANT_REF', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction } = await import('@/app/(app)/accidentabilidad/actions');
    const r = await registerIncidenteAction({ ...baseCasi, informe_id: informeBId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('CROSS_TENANT_REF');
  });
});

describe('corregirIncidenteAction', () => {
  it('10. happy → corrected (nuevo registro con corrige_id)', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction, corregirIncidenteAction } =
      await import('@/app/(app)/accidentabilidad/actions');
    const alta = await registerIncidenteAction(baseCasi);
    expect(alta.ok).toBe(true);
    if (!alta.ok) return;

    const corr = await corregirIncidenteAction({
      ...baseCasi,
      descripcion: 'Casi-accidente corregido con más detalle.',
      corrige_id: alta.incidenteId,
    });
    expect(corr.ok).toBe(true);
    if (!corr.ok) return;

    const { data: row } = await admin
      .from('incidentes')
      .select('corrige_id')
      .eq('id', corr.incidenteId)
      .single();
    expect(row?.corrige_id).toBe(alta.incidenteId);
  });

  it('11. doble corrección del mismo registro → ALREADY_CORRECTED', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction, corregirIncidenteAction } =
      await import('@/app/(app)/accidentabilidad/actions');
    const alta = await registerIncidenteAction(baseCasi);
    expect(alta.ok).toBe(true);
    if (!alta.ok) return;

    const corr1 = await corregirIncidenteAction({ ...baseCasi, corrige_id: alta.incidenteId });
    expect(corr1.ok).toBe(true);

    const corr2 = await corregirIncidenteAction({ ...baseCasi, corrige_id: alta.incidenteId });
    expect(corr2.ok).toBe(false);
    if (corr2.ok) return;
    expect(corr2.code).toBe('ALREADY_CORRECTED');
  });
});

describe('anularIncidenteAction', () => {
  it('12. happy → tombstone anulacion=true + alta sale de la vista vigentes', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction, anularIncidenteAction } =
      await import('@/app/(app)/accidentabilidad/actions');
    const { getIncidentes } = await import('@/app/(app)/accidentabilidad/queries');
    const { createClient: createServerClient } = await import('@/shared/supabase/server');

    const alta = await registerIncidenteAction(baseCasi);
    expect(alta.ok).toBe(true);
    if (!alta.ok) return;

    const anul = await anularIncidenteAction({
      id: alta.incidenteId,
      motivo: 'Cargado por error.',
    });
    expect(anul.ok).toBe(true);
    if (!anul.ok) return;

    const { data: tomb } = await admin
      .from('incidentes')
      .select('anulacion, corrige_id, descripcion')
      .eq('id', anul.incidenteId)
      .single();
    expect(tomb?.anulacion).toBe(true);
    expect(tomb?.corrige_id).toBe(alta.incidenteId);
    expect(tomb?.descripcion.startsWith('Anulación:')).toBe(true);

    // El alta anulada NO aparece en la vista vigentes.
    const sb = await createServerClient();
    const vigentes = await getIncidentes(sb, {});
    expect(vigentes.some((v) => v.id === alta.incidenteId)).toBe(false);
  });
});

describe('generarInvestigacionIaAction (T-075)', () => {
  it('13. happy: accidente con cliente → crea informe accidente + linkea + redirect /editar', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction, generarInvestigacionIaAction } =
      await import('@/app/(app)/accidentabilidad/actions');

    const alta = await registerIncidenteAction({ ...baseAccidente, cliente_id: clienteAId });
    expect(alta.ok).toBe(true);
    if (!alta.ok) return;

    const gen = await generarInvestigacionIaAction(alta.incidenteId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    expect(gen.redirectTo).toMatch(/^\/informes\/[0-9a-f-]{36}\/editar$/);

    // El incidente quedó vinculado al informe creado.
    const { data: inc } = await admin
      .from('incidentes')
      .select('informe_id')
      .eq('id', alta.incidenteId)
      .single();
    expect(inc?.informe_id).toBe(gen.informeId);

    // El informe es tipo accidente, del tenant cA, con cliente_id propagado.
    const { data: inf } = await admin
      .from('informes')
      .select('tipo, consultora_id, cliente_id')
      .eq('id', gen.informeId)
      .single();
    expect(inf).toMatchObject({ tipo: 'accidente', consultora_id: cAId, cliente_id: clienteAId });

    // Audit del link.
    const { data: audit } = await admin
      .from('audit_log')
      .select('action')
      .eq('entity_type', 'incidentes')
      .eq('entity_id', alta.incidenteId)
      .eq('action', 'linked')
      .maybeSingle();
    expect(audit?.action).toBe('linked');
  });

  it('14. NO_CLIENTE: accidente sin cliente asociado', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction, generarInvestigacionIaAction } =
      await import('@/app/(app)/accidentabilidad/actions');

    const alta = await registerIncidenteAction(baseAccidente); // sin cliente_id
    expect(alta.ok).toBe(true);
    if (!alta.ok) return;

    const gen = await generarInvestigacionIaAction(alta.incidenteId);
    expect(gen.ok).toBe(false);
    if (gen.ok) return;
    expect(gen.code).toBe('NO_CLIENTE');
  });

  it('15. NOT_ACCIDENTE: un casi_accidente no se investiga', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction, generarInvestigacionIaAction } =
      await import('@/app/(app)/accidentabilidad/actions');

    const alta = await registerIncidenteAction({ ...baseCasi, cliente_id: clienteAId });
    expect(alta.ok).toBe(true);
    if (!alta.ok) return;

    const gen = await generarInvestigacionIaAction(alta.incidenteId);
    expect(gen.ok).toBe(false);
    if (gen.ok) return;
    expect(gen.code).toBe('NOT_ACCIDENTE');
  });

  it('16. ALREADY_LINKED: segundo intento redirige al informe existente', async () => {
    await signInAs(emailMemberA);
    const { registerIncidenteAction, generarInvestigacionIaAction } =
      await import('@/app/(app)/accidentabilidad/actions');

    const alta = await registerIncidenteAction({ ...baseAccidente, cliente_id: clienteAId });
    expect(alta.ok).toBe(true);
    if (!alta.ok) return;

    const gen1 = await generarInvestigacionIaAction(alta.incidenteId);
    expect(gen1.ok).toBe(true);
    if (!gen1.ok) return;

    const gen2 = await generarInvestigacionIaAction(alta.incidenteId);
    expect(gen2.ok).toBe(false);
    if (gen2.ok) return;
    expect(gen2.code).toBe('ALREADY_LINKED');
    if (gen2.code !== 'ALREADY_LINKED') return;
    expect(gen2.redirectTo).toBe(`/informes/${gen1.informeId}`);
  });
});
