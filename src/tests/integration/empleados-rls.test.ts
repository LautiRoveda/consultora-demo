/**
 * T-052 · Tests RLS + audit + constraints + FK RESTRICT de `public.empleados`.
 *
 * Cobertura:
 * - RLS: SELECT/INSERT/UPDATE policies (any member del tenant) + DELETE default-deny.
 * - Constraints: CHECK dni regex (7-8 digitos, sin puntos) + CHECK cuil regex AR-specific +
 *   UNIQUE partial (consultora_id, cliente_id, dni) WHERE archived_at IS NULL (multi-empleo
 *   cross-cliente permitido + archive permite re-insertar mismo DNI).
 * - Audit trigger: row escrita en audit_log al INSERT/UPDATE con shape esperado + diff guard
 *   (notas excluido de payload Y guard).
 * - FK RESTRICT: cliente_id ON DELETE RESTRICT bloquea hard-delete de cliente con empleados activos.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration src/tests/integration/empleados-rls.test.ts`.
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
const slugA = `t052-rls-a-${runId}`;
const slugB = `t052-rls-b-${runId}`;
const emailOwnerA = `t052-rls-owner-a-${runId}@example.com`;
const emailMemberA = `t052-rls-member-a-${runId}@example.com`;
const emailOwnerB = `t052-rls-owner-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let clientMemberA: SupabaseClient<Database>;
let clientAnon: SupabaseClient<Database>;

/** Clientes fixtures: uno por tenant. */
let clienteAId: string;
let clienteBId: string;

/** Empleado fixture en cA + clienteA. */
let empleadoFixtureId: string;
const empleadoFixtureDni = '30123456';

/**
 * Genera DNI random con formato AR valido (8 digitos sin puntos).
 * Cada test que inserta empleado nuevo debe usar makeDni() para evitar
 * colision con la UNIQUE constraint partial (consultora_id, cliente_id, dni)
 * WHERE archived_at IS NULL.
 */
function makeDni(): string {
  return Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, '0');
}

beforeAll(async () => {
  // Consultoras — secuenciales con error capture (Promise.all sobre admin
  // sufre flakiness de red en sa-east-1, ConnectTimeoutError UND_ERR).
  const resA = await admin
    .from('consultoras')
    .insert({ name: 'T052 RLS cA', slug: slugA })
    .select('id')
    .single();
  if (resA.error || !resA.data) throw new Error(`insert cA failed: ${JSON.stringify(resA.error)}`);
  cAId = resA.data.id;

  const resB = await admin
    .from('consultoras')
    .insert({ name: 'T052 RLS cB', slug: slugB })
    .select('id')
    .single();
  if (resB.error || !resB.data) throw new Error(`insert cB failed: ${JSON.stringify(resB.error)}`);
  cBId = resB.data.id;

  // Users — secuencial con error capture (Promise.all sobre auth.admin
  // tiene flakiness en sa-east-1 / rate limit silencioso).
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

  // Memberships.
  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  // Claim JWT (T-016 fast-path).
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  // Clientes fixtures (uno por tenant, necesario para FK obligatorio).
  const cliA = await admin
    .from('clientes')
    .insert({
      consultora_id: cAId,
      razon_social: 'T052 Cliente A',
      cuit: '20-30123456-7',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  if (cliA.error || !cliA.data)
    throw new Error(`insert clienteA failed: ${JSON.stringify(cliA.error)}`);
  clienteAId = cliA.data.id;

  const cliB = await admin
    .from('clientes')
    .insert({
      consultora_id: cBId,
      razon_social: 'T052 Cliente B',
      cuit: '20-40123456-8',
      created_by: ownerBId,
    })
    .select('id')
    .single();
  if (cliB.error || !cliB.data)
    throw new Error(`insert clienteB failed: ${JSON.stringify(cliB.error)}`);
  clienteBId = cliB.data.id;

  // Cliente anon con session firmada (solo memberA: cubre todos los casos
  // RLS — los tests cross-tenant usan memberA contra rows de cB; el spoof
  // test usa created_by=ownerBId sin necesidad de firmar como ownerB).
  const sbMA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await sbMA.auth.signInWithPassword({ email: emailMemberA, password });
  clientMemberA = sbMA;

  // Cliente anon sin sesion (para test 3).
  clientAnon = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });

  // Empleado fixture en cA + clienteA (creado via admin con created_by=ownerA).
  const { data: emp } = await admin
    .from('empleados')
    .insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'Juan',
      apellido: 'Fixture',
      dni: empleadoFixtureDni,
      cuil: '20-30123456-9',
      puesto: 'Operario',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  empleadoFixtureId = emp!.id;
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
  ]);
});

describe('empleados RLS · SELECT', () => {
  it('1. member de cA SELECT empleados de cA', async () => {
    const { data, error } = await clientMemberA
      .from('empleados')
      .select('id, nombre, apellido, dni')
      .eq('id', empleadoFixtureId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(empleadoFixtureId);
    expect(data?.apellido).toBe('Fixture');
    expect(data?.dni).toBe(empleadoFixtureDni);
  });

  it('2. member de cA NO ve empleados de cB (cross-tenant)', async () => {
    // Setup: admin INSERT empleado en cB.
    const { data: empB } = await admin
      .from('empleados')
      .insert({
        consultora_id: cBId,
        cliente_id: clienteBId,
        nombre: 'Invisible',
        apellido: 'Empleado',
        dni: makeDni(),
        created_by: ownerBId,
      })
      .select('id')
      .single();
    const empBId = empB!.id;

    // memberA de cA intenta verlo: RLS filtra -> data null.
    const { data, error } = await clientMemberA
      .from('empleados')
      .select('id')
      .eq('id', empBId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('3. anon NO ve empleados (sin sesion)', async () => {
    // Helpers T-015 tienen grant 'to authenticated, service_role' (NO anon).
    // Anon sin sesion no puede ejecutar is_member_of_consultora() → policy
    // USING falla cerrada con error 42501 'permission denied for function'.
    // Defensa en profundidad: anon no llega ni a evaluar el filtro.
    const { data, error } = await clientAnon
      .from('empleados')
      .select('id')
      .eq('id', empleadoFixtureId)
      .maybeSingle();
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
    expect(error?.message.toLowerCase()).toMatch(/permission denied/);
  });
});

describe('empleados RLS · INSERT', () => {
  it('4. member de cA inserta con consultora_id=cA + cliente_id=clienteA + created_by=self', async () => {
    const { data, error } = await clientMemberA
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Pedro',
        apellido: 'MemberInsert',
        dni: makeDni(),
        created_by: memberAId,
      })
      .select('id, consultora_id, cliente_id, created_by')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeDefined();
    expect(data?.consultora_id).toBe(cAId);
    expect(data?.cliente_id).toBe(clienteAId);
    expect(data?.created_by).toBe(memberAId);
  });

  it('5. member de cA NO puede insertar con consultora_id=cB (cross-tenant)', async () => {
    const { error } = await clientMemberA.from('empleados').insert({
      consultora_id: cBId,
      cliente_id: clienteBId,
      nombre: 'Hacker',
      apellido: 'CrossTenant',
      dni: makeDni(),
      created_by: memberAId,
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('6. member de cA NO puede spoof created_by=otherUserId', async () => {
    const { error } = await clientMemberA.from('empleados').insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'Spoof',
      apellido: 'Creator',
      dni: makeDni(),
      created_by: ownerBId, // user de otra consultora — spoof intent
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });
});

describe('empleados RLS · UPDATE', () => {
  it('7. member non-owner de cA puede UPDATE empleado de cA', async () => {
    // Setup: admin INSERT empleado en cA con created_by=ownerA.
    const { data: fresh } = await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Pre',
        apellido: 'Update',
        dni: makeDni(),
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const freshId = fresh!.id;

    // memberA (no creator, no owner) puede UPDATE — empleados son data
    // compartida del tenant.
    const { data, error } = await clientMemberA
      .from('empleados')
      .update({ apellido: 'UpdatedByMemberA' })
      .eq('id', freshId)
      .select('id, apellido');
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.apellido).toBe('UpdatedByMemberA');
  });

  it('8. member de cA NO puede UPDATE empleado de cB (cross-tenant)', async () => {
    // Setup: admin INSERT empleado en cB.
    const { data: empB } = await admin
      .from('empleados')
      .insert({
        consultora_id: cBId,
        cliente_id: clienteBId,
        nombre: 'cB',
        apellido: 'Protected',
        dni: makeDni(),
        created_by: ownerBId,
      })
      .select('id')
      .single();
    const empBId = empB!.id;

    // memberA intenta UPDATE: RLS USING filtra → 0 rows affected, sin error.
    const { data, error } = await clientMemberA
      .from('empleados')
      .update({ apellido: 'Hack' })
      .eq('id', empBId)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    // Verificar via admin que apellido sigue intacto.
    const { data: still } = await admin
      .from('empleados')
      .select('apellido')
      .eq('id', empBId)
      .single();
    expect(still?.apellido).toBe('Protected');
  });

  it('9. archive (UPDATE archived_at = now()) funciona desde cualquier member', async () => {
    // Setup: admin INSERT empleado fresco en cA.
    const { data: fresh } = await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Pre',
        apellido: 'Archive',
        dni: makeDni(),
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const freshId = fresh!.id;

    // memberA (no creator, no owner) archiva.
    const archivedAt = new Date().toISOString();
    const { data, error } = await clientMemberA
      .from('empleados')
      .update({ archived_at: archivedAt })
      .eq('id', freshId)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length).toBe(1);

    // Verificar via admin que archived_at quedo populado.
    const { data: still } = await admin
      .from('empleados')
      .select('archived_at')
      .eq('id', freshId)
      .single();
    expect(still?.archived_at).not.toBeNull();
  });
});

describe('empleados constraints', () => {
  it('10. CHECK dni regex bloquea: 5 digitos / 9 digitos / con puntos', async () => {
    // 5 digitos (corto).
    const { error: e1 } = await admin.from('empleados').insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'DNI',
      apellido: 'Corto',
      dni: '12345',
      created_by: ownerAId,
    });
    expect(e1).not.toBeNull();
    expect(e1?.code).toBe('23514');

    // 9 digitos (largo).
    const { error: e2 } = await admin.from('empleados').insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'DNI',
      apellido: 'Largo',
      dni: '123456789',
      created_by: ownerAId,
    });
    expect(e2).not.toBeNull();
    expect(e2?.code).toBe('23514');

    // Con puntos (formato visual humano).
    const { error: e3 } = await admin.from('empleados').insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'DNI',
      apellido: 'ConPuntos',
      dni: '12.345.678',
      created_by: ownerAId,
    });
    expect(e3).not.toBeNull();
    expect(e3?.code).toBe('23514');

    // Sanity: 7 digitos OK + 8 digitos OK.
    const { error: eOk7 } = await admin.from('empleados').insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'DNI',
      apellido: 'Legacy7',
      dni: '1234567',
      created_by: ownerAId,
    });
    expect(eOk7).toBeNull();

    const { error: eOk8 } = await admin.from('empleados').insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'DNI',
      apellido: 'Modern8',
      dni: makeDni(),
      created_by: ownerAId,
    });
    expect(eOk8).toBeNull();
  });

  it('11. CHECK cuil regex bloquea CUIL sin guiones', async () => {
    const { error } = await admin.from('empleados').insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'CUIL',
      apellido: 'Invalido',
      dni: makeDni(),
      cuil: '20123456789', // sin guiones → no matchea regex
      created_by: ownerAId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
    expect(error?.message.toLowerCase()).toMatch(/check constraint/);
  });

  it('12. UNIQUE (consultora_id, cliente_id, dni) WHERE archived_at IS NULL — duplicado mismo cliente fail / archive+re-insert OK / mismo DNI en otro cliente OK (multi-empleo)', async () => {
    const dniShared = makeDni();

    // INSERT primer empleado activo con dniShared en clienteA.
    const { data: first, error: e1 } = await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Unique',
        apellido: 'Primero',
        dni: dniShared,
        created_by: ownerAId,
      })
      .select('id')
      .single();
    expect(e1).toBeNull();
    expect(first?.id).toBeDefined();

    // INSERT segundo empleado activo con MISMO DNI en MISMO clienteA
    // → debe fallar con duplicate key (23505).
    const { error: e2 } = await admin.from('empleados').insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'Unique',
      apellido: 'Duplicado',
      dni: dniShared,
      created_by: ownerAId,
    });
    expect(e2).not.toBeNull();
    expect(e2?.code).toBe('23505');

    // Archivar el primero.
    const { error: eArchive } = await admin
      .from('empleados')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', first!.id);
    expect(eArchive).toBeNull();

    // INSERT tercer empleado con MISMO DNI en MISMO clienteA → ahora debe pasar
    // porque el primero ya no esta en el partial index (archived_at IS NOT NULL).
    const { data: third, error: e3 } = await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Unique',
        apellido: 'PostArchive',
        dni: dniShared,
        created_by: ownerAId,
      })
      .select('id')
      .single();
    expect(e3).toBeNull();
    expect(third?.id).toBeDefined();

    // Crear segundo cliente en cA para multi-empleo test.
    const { data: cliExtra } = await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: 'T052 Cliente Extra',
        cuit: '20-50123456-9',
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const clienteExtraId = cliExtra!.id;

    // INSERT mismo DNI activo en OTRO cliente del mismo tenant → permitido
    // (caso multi-empleo: tecnico part-time en 2 PYMEs).
    const { data: multi, error: e4 } = await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteExtraId,
        nombre: 'Unique',
        apellido: 'MultiEmpleo',
        dni: dniShared,
        created_by: ownerAId,
      })
      .select('id')
      .single();
    expect(e4).toBeNull();
    expect(multi?.id).toBeDefined();
  });
});

describe('empleados audit_log', () => {
  it('13. INSERT escribe audit_log row con shape esperado (7 fields en after_data)', async () => {
    const { data: target, error: eIns } = await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Audit',
        apellido: 'Insert',
        dni: makeDni(),
        cuil: '20-99999999-0',
        puesto: 'Soldador',
        fecha_ingreso: '2024-01-15',
        fecha_nacimiento: '1980-06-20', // NO va al payload INSERT
        email: 'audit@example.com', // NO va al payload INSERT
        telefono: '+541123456789', // NO va al payload INSERT
        notas: 'lorem ipsum', // NO va al payload INSERT
        created_by: ownerAId,
      })
      .select('id')
      .single();
    expect(eIns).toBeNull();

    const { data: log } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, before_data, after_data, consultora_id')
      .eq('entity_type', 'empleados')
      .eq('entity_id', target!.id)
      .eq('action', 'created')
      .single();

    expect(log?.action).toBe('created');
    expect(log?.entity_type).toBe('empleados');
    expect(log?.entity_id).toBe(target!.id);
    expect(log?.consultora_id).toBe(cAId);
    expect(log?.before_data).toBeNull();
    const after = log?.after_data as Record<string, unknown>;
    expect(after.cliente_id).toBe(clienteAId);
    expect(after.nombre).toBe('Audit');
    expect(after.apellido).toBe('Insert');
    expect(after.dni).toBeTypeOf('string');
    expect(after.cuil).toBe('20-99999999-0');
    expect(after.puesto).toBe('Soldador');
    expect(after.fecha_ingreso).toBe('2024-01-15');
    // Defensivo: payload INSERT NO incluye los campos no-listados.
    expect(after.fecha_nacimiento).toBeUndefined();
    expect(after.email).toBeUndefined();
    expect(after.telefono).toBeUndefined();
    expect(after.notas).toBeUndefined();
    expect(after.archived_at).toBeUndefined();
  });

  it('14. UPDATE solo de notas NO escribe audit; UPDATE de apellido SI (diff guard 11 fields)', async () => {
    // Setup: INSERT empleado fresco.
    const { data: fresh } = await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Audit',
        apellido: 'Diff',
        dni: makeDni(),
        notas: 'inicial',
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const freshId = fresh!.id;

    // Sanity: capturar count de audit rows action='updated' para este entity_id (debe ser 0).
    const baseline = await admin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'empleados')
      .eq('entity_id', freshId)
      .eq('action', 'updated');
    expect(baseline.count ?? 0).toBe(0);

    // UPDATE solo notas → fuera del diff guard → NO debe escribir audit row.
    const { error: e1 } = await admin
      .from('empleados')
      .update({ notas: 'modificado solo notas' })
      .eq('id', freshId);
    expect(e1).toBeNull();

    const afterNotasOnly = await admin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'empleados')
      .eq('entity_id', freshId)
      .eq('action', 'updated');
    expect(afterNotasOnly.count ?? 0).toBe(0);

    // UPDATE apellido → SI debe escribir audit row.
    const { error: e2 } = await admin
      .from('empleados')
      .update({ apellido: 'DiffUpdated' })
      .eq('id', freshId);
    expect(e2).toBeNull();

    const afterApellido = await admin
      .from('audit_log')
      .select('id, before_data, after_data', { count: 'exact' })
      .eq('entity_type', 'empleados')
      .eq('entity_id', freshId)
      .eq('action', 'updated');
    expect(afterApellido.count ?? 0).toBe(1);
    const row = afterApellido.data?.[0];
    const before = row?.before_data as Record<string, unknown>;
    const after = row?.after_data as Record<string, unknown>;
    expect(before.apellido).toBe('Diff');
    expect(after.apellido).toBe('DiffUpdated');
    // notas NO va al payload UPDATE.
    expect(before.notas).toBeUndefined();
    expect(after.notas).toBeUndefined();
  });
});

describe('empleados DELETE + FK RESTRICT', () => {
  it('15. member NO puede DELETE empleado (default-deny) + admin NO puede DELETE cliente con empleados activos (FK on delete restrict)', async () => {
    // (a) Setup: admin INSERT empleado fresco en cA + clienteA.
    const { data: fresh } = await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Pre',
        apellido: 'Delete',
        dni: makeDni(),
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const freshId = fresh!.id;

    // memberA intenta DELETE: sin policy DELETE para authenticated, RLS
    // filtra el row del scope → 0 rows affected, sin error.
    const { data: delData, error: delErr } = await clientMemberA
      .from('empleados')
      .delete()
      .eq('id', freshId)
      .select('id');
    expect(delErr).toBeNull();
    expect(delData?.length ?? 0).toBe(0);

    // Verificar via admin que el empleado sigue ahi.
    const { data: still } = await admin
      .from('empleados')
      .select('id')
      .eq('id', freshId)
      .maybeSingle();
    expect(still?.id).toBe(freshId);

    // (b) FK RESTRICT: crear cliente aislado con empleado activo y verificar
    // que el DELETE del cliente esta bloqueado por on delete restrict.
    const { data: cliTmp } = await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: 'T052 cliente con empleados',
        cuit: '20-77777777-7',
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const cliTmpId = cliTmp!.id;

    const { data: empTmp } = await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: cliTmpId,
        nombre: 'FK',
        apellido: 'Restrict',
        dni: makeDni(),
        created_by: ownerAId,
      })
      .select('id')
      .single();
    expect(empTmp?.id).toBeDefined();

    // DELETE cliente con empleado activo → bloqueado por FK on delete restrict.
    const { error: deleteClienteError } = await admin.from('clientes').delete().eq('id', cliTmpId);
    expect(deleteClienteError).not.toBeNull();
    expect(deleteClienteError?.message.toLowerCase()).toMatch(/foreign key|violates|restrict/);

    // Cliente sigue ahi (y el empleado tambien, todo intacto).
    const { data: stillCli } = await admin
      .from('clientes')
      .select('id')
      .eq('id', cliTmpId)
      .maybeSingle();
    expect(stillCli?.id).toBe(cliTmpId);
  });
});
