/**
 * T-047 · Tests RLS + audit + cascade + constraints de `public.clientes`.
 *
 * Cobertura:
 * - RLS: SELECT/INSERT/UPDATE policies (any member del tenant) + DELETE default-deny.
 * - Constraints: CHECK cuit regex AR-specific + UNIQUE partial (consultora_id, cuit) WHERE archived_at IS NULL.
 * - Audit trigger: row escrita en audit_log al INSERT/UPDATE/DELETE con shape esperado + diff guard (notas excluido).
 * - Cascade: borrar consultora cascade clientes.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration src/tests/integration/clientes-rls.test.ts`.
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
const slugA = `t047-rls-a-${runId}`;
const slugB = `t047-rls-b-${runId}`;
const emailOwnerA = `t047-rls-owner-a-${runId}@example.com`;
const emailMemberA = `t047-rls-member-a-${runId}@example.com`;
const emailOwnerB = `t047-rls-owner-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let clientMemberA: SupabaseClient<Database>;
let clientAnon: SupabaseClient<Database>;

/** Cliente fixture en cA creado por ownerA. */
let clienteFixtureId: string;
const clienteFixtureCuit = '20-30123456-7';

/**
 * Genera CUIT random con formato AR válido XX-XXXXXXXX-X.
 * Cada test que inserta cliente nuevo debe usar makeCuit() para evitar
 * colisión con la UNIQUE constraint partial (consultora_id, cuit) WHERE
 * archived_at IS NULL.
 */
function makeCuit(): string {
  const digits = Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, '0');
  return `30-${digits}-7`;
}

beforeAll(async () => {
  // Consultoras — secuenciales con error capture (Promise.all sobre admin
  // sufre flakiness de red en sa-east-1, ConnectTimeoutError UND_ERR).
  const resA = await admin
    .from('consultoras')
    .insert({ name: 'T047 RLS cA', slug: slugA })
    .select('id')
    .single();
  if (resA.error || !resA.data) throw new Error(`insert cA failed: ${JSON.stringify(resA.error)}`);
  cAId = resA.data.id;

  const resB = await admin
    .from('consultoras')
    .insert({ name: 'T047 RLS cB', slug: slugB })
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

  // Cliente anon con session firmada (solo memberA: cubre todos los casos
  // RLS — los tests cross-tenant usan memberA contra rows de cB; el spoof
  // test usa created_by=ownerBId sin necesidad de firmar como ownerB).
  const sbMA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await sbMA.auth.signInWithPassword({ email: emailMemberA, password });
  clientMemberA = sbMA;

  // Cliente anon sin sesion (para test 3).
  clientAnon = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });

  // Cliente fixture en cA (creado via admin con created_by=ownerA, CUIT fijo).
  const { data: c } = await admin
    .from('clientes')
    .insert({
      consultora_id: cAId,
      razon_social: 'T047 Fixture SA',
      cuit: clienteFixtureCuit,
      nombre_fantasia: 'Fixture',
      industria: 'Industria',
      localidad: 'CABA',
      provincia: 'CABA',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  clienteFixtureId = c!.id;
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
  ]);
});

describe('clientes RLS · SELECT', () => {
  it('1. member de cA SELECT clientes de cA', async () => {
    const { data, error } = await clientMemberA
      .from('clientes')
      .select('id, razon_social, cuit')
      .eq('id', clienteFixtureId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(clienteFixtureId);
    expect(data?.razon_social).toBe('T047 Fixture SA');
  });

  it('2. member de cA NO ve clientes de cB (cross-tenant)', async () => {
    // Setup: admin INSERT cliente en cB.
    const { data: cliBs } = await admin
      .from('clientes')
      .insert({
        consultora_id: cBId,
        razon_social: 'T047 cB invisible',
        cuit: makeCuit(),
        created_by: ownerBId,
      })
      .select('id')
      .single();
    const cliBId = cliBs!.id;

    // memberA de cA intenta verlo: RLS filtra -> data null.
    const { data, error } = await clientMemberA
      .from('clientes')
      .select('id')
      .eq('id', cliBId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('3. anon NO ve clientes (sin sesion)', async () => {
    // Helpers T-015 tienen grant 'to authenticated, service_role' (NO anon).
    // Anon sin sesion no puede ejecutar is_member_of_consultora() → policy
    // USING falla cerrada con error 42501 'permission denied for function'.
    // Defensa en profundidad: anon no llega ni a evaluar el filtro.
    const { data, error } = await clientAnon
      .from('clientes')
      .select('id')
      .eq('id', clienteFixtureId)
      .maybeSingle();
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
    expect(error?.message.toLowerCase()).toMatch(/permission denied/);
  });
});

describe('clientes RLS · INSERT', () => {
  it('4. member de cA inserta con consultora_id=cA + created_by=self', async () => {
    const { data, error } = await clientMemberA
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: 'T047 member-A insert',
        cuit: makeCuit(),
        created_by: memberAId,
      })
      .select('id, consultora_id, created_by')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeDefined();
    expect(data?.consultora_id).toBe(cAId);
    expect(data?.created_by).toBe(memberAId);
  });

  it('5. member de cA NO puede insertar con consultora_id=cB (cross-tenant)', async () => {
    const { error } = await clientMemberA.from('clientes').insert({
      consultora_id: cBId,
      razon_social: 'T047 hacker cross-tenant',
      cuit: makeCuit(),
      created_by: memberAId,
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('6. member de cA NO puede spoof created_by=otherUserId', async () => {
    const { error } = await clientMemberA.from('clientes').insert({
      consultora_id: cAId,
      razon_social: 'T047 spoofed creator',
      cuit: makeCuit(),
      created_by: ownerBId, // user de otra consultora — spoof intent
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });
});

describe('clientes RLS · UPDATE', () => {
  it('7. member non-owner de cA puede UPDATE cliente de cA', async () => {
    // Setup: admin INSERT cliente en cA con created_by=ownerA.
    const { data: fresh } = await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: 'T047 pre-update',
        cuit: makeCuit(),
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const freshId = fresh!.id;

    // memberA (no creator, no owner) puede UPDATE — clientes son data
    // compartida del tenant.
    const { data, error } = await clientMemberA
      .from('clientes')
      .update({ razon_social: 'T047 updated by memberA' })
      .eq('id', freshId)
      .select('id, razon_social');
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.razon_social).toBe('T047 updated by memberA');
  });

  it('8. member de cA NO puede UPDATE cliente de cB (cross-tenant)', async () => {
    // Setup: admin INSERT cliente en cB.
    const { data: cliB } = await admin
      .from('clientes')
      .insert({
        consultora_id: cBId,
        razon_social: 'T047 cB protected',
        cuit: makeCuit(),
        created_by: ownerBId,
      })
      .select('id')
      .single();
    const cliBId = cliB!.id;

    // memberA intenta UPDATE: RLS USING filtra → 0 rows affected, sin error.
    const { data, error } = await clientMemberA
      .from('clientes')
      .update({ razon_social: 'Hack' })
      .eq('id', cliBId)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    // Verificar via admin que razon_social sigue intacta.
    const { data: still } = await admin
      .from('clientes')
      .select('razon_social')
      .eq('id', cliBId)
      .single();
    expect(still?.razon_social).toBe('T047 cB protected');
  });

  it('9. archive (UPDATE archived_at = now()) funciona desde cualquier member', async () => {
    // Setup: admin INSERT cliente fresco en cA.
    const { data: fresh } = await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: 'T047 pre-archive',
        cuit: makeCuit(),
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const freshId = fresh!.id;

    // memberA (no creator, no owner) archiva.
    const archivedAt = new Date().toISOString();
    const { data, error } = await clientMemberA
      .from('clientes')
      .update({ archived_at: archivedAt })
      .eq('id', freshId)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length).toBe(1);

    // Verificar via admin que archived_at quedo populado.
    const { data: still } = await admin
      .from('clientes')
      .select('archived_at')
      .eq('id', freshId)
      .single();
    expect(still?.archived_at).not.toBeNull();
  });
});

describe('clientes RLS · DELETE', () => {
  it('10. member de cA NO puede DELETE cliente de cA (default-deny)', async () => {
    // Setup: admin INSERT cliente fresco en cA.
    const { data: fresh } = await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: 'T047 pre-delete',
        cuit: makeCuit(),
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const freshId = fresh!.id;

    // memberA intenta DELETE: sin policy DELETE para authenticated, RLS
    // filtra el row del scope → 0 rows affected, sin error.
    const { data, error } = await clientMemberA
      .from('clientes')
      .delete()
      .eq('id', freshId)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    // Verificar via admin que el cliente sigue ahi.
    const { data: still } = await admin
      .from('clientes')
      .select('id')
      .eq('id', freshId)
      .maybeSingle();
    expect(still?.id).toBe(freshId);
  });
});

describe('clientes constraints', () => {
  it('11. UNIQUE (consultora_id, cuit) WHERE archived_at IS NULL bloquea duplicado + permite tras archive', async () => {
    const cuitShared = makeCuit();

    // INSERT primer cliente activo con cuitShared.
    const { data: first, error: e1 } = await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: 'T047 unique primero',
        cuit: cuitShared,
        created_by: ownerAId,
      })
      .select('id')
      .single();
    expect(e1).toBeNull();
    expect(first?.id).toBeDefined();

    // INSERT segundo cliente activo con MISMO CUIT en mismo tenant
    // → debe fallar con duplicate key (23505).
    const { error: e2 } = await admin.from('clientes').insert({
      consultora_id: cAId,
      razon_social: 'T047 unique duplicado',
      cuit: cuitShared,
      created_by: ownerAId,
    });
    expect(e2).not.toBeNull();
    expect(e2?.code).toBe('23505');

    // Archivar el primero.
    const { error: eArchive } = await admin
      .from('clientes')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', first!.id);
    expect(eArchive).toBeNull();

    // INSERT tercer cliente con MISMO CUIT en mismo tenant → ahora debe pasar
    // porque el primero ya no esta en el partial index (archived_at IS NOT NULL).
    const { data: third, error: e3 } = await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: 'T047 unique post-archive',
        cuit: cuitShared,
        created_by: ownerAId,
      })
      .select('id')
      .single();
    expect(e3).toBeNull();
    expect(third?.id).toBeDefined();
  });

  it('12. CHECK cuit format bloquea CUIT sin guiones', async () => {
    const { error } = await admin.from('clientes').insert({
      consultora_id: cAId,
      razon_social: 'T047 cuit invalido',
      cuit: '30123456789', // sin guiones → no matchea regex AR
      created_by: ownerAId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
    expect(error?.message.toLowerCase()).toMatch(/check constraint/);
  });
});

describe('clientes audit_log', () => {
  it('13. INSERT escribe audit_log row con shape esperado', async () => {
    const { data: target, error: eIns } = await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: 'T047 audit insert',
        cuit: makeCuit(),
        nombre_fantasia: 'AuditCo',
        industria: 'Servicios',
        localidad: 'Rosario',
        provincia: 'SF',
        domicilio: 'Calle 123', // NO va al payload INSERT
        notas: 'lorem ipsum', // NO va al payload INSERT
        created_by: ownerAId,
      })
      .select('id')
      .single();
    expect(eIns).toBeNull();

    const { data: log } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, before_data, after_data, consultora_id')
      .eq('entity_type', 'clientes')
      .eq('entity_id', target!.id)
      .eq('action', 'created')
      .single();

    expect(log?.action).toBe('created');
    expect(log?.entity_type).toBe('clientes');
    expect(log?.entity_id).toBe(target!.id);
    expect(log?.consultora_id).toBe(cAId);
    expect(log?.before_data).toBeNull();
    const after = log?.after_data as Record<string, unknown>;
    expect(after.razon_social).toBe('T047 audit insert');
    expect(after.cuit).toBeTypeOf('string');
    expect(after.nombre_fantasia).toBe('AuditCo');
    expect(after.industria).toBe('Servicios');
    expect(after.localidad).toBe('Rosario');
    expect(after.provincia).toBe('SF');
    // Defensivo: payload INSERT NO incluye los campos no-listados.
    expect(after.domicilio).toBeUndefined();
    expect(after.notas).toBeUndefined();
    expect(after.contacto_email).toBeUndefined();
    expect(after.archived_at).toBeUndefined();
  });

  it('14. UPDATE solo de notas NO escribe audit; UPDATE de razon_social SI', async () => {
    // Setup: INSERT cliente fresco.
    const { data: fresh } = await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: 'T047 audit diff',
        cuit: makeCuit(),
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
      .eq('entity_type', 'clientes')
      .eq('entity_id', freshId)
      .eq('action', 'updated');
    expect(baseline.count ?? 0).toBe(0);

    // UPDATE solo notas → fuera del diff guard → NO debe escribir audit row.
    const { error: e1 } = await admin
      .from('clientes')
      .update({ notas: 'modificado solo notas' })
      .eq('id', freshId);
    expect(e1).toBeNull();

    const afterNotasOnly = await admin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'clientes')
      .eq('entity_id', freshId)
      .eq('action', 'updated');
    expect(afterNotasOnly.count ?? 0).toBe(0);

    // UPDATE razon_social → SI debe escribir audit row.
    const { error: e2 } = await admin
      .from('clientes')
      .update({ razon_social: 'T047 audit diff renombrado' })
      .eq('id', freshId);
    expect(e2).toBeNull();

    const afterRazonSocial = await admin
      .from('audit_log')
      .select('id, before_data, after_data', { count: 'exact' })
      .eq('entity_type', 'clientes')
      .eq('entity_id', freshId)
      .eq('action', 'updated');
    expect(afterRazonSocial.count ?? 0).toBe(1);
    const row = afterRazonSocial.data?.[0];
    const before = row?.before_data as Record<string, unknown>;
    const after = row?.after_data as Record<string, unknown>;
    expect(before.razon_social).toBe('T047 audit diff');
    expect(after.razon_social).toBe('T047 audit diff renombrado');
    // notas NO va al payload UPDATE.
    expect(before.notas).toBeUndefined();
    expect(after.notas).toBeUndefined();
  });
});

describe('clientes cascade', () => {
  it('15. DELETE consultora bloqueado por audit_log retention (invariante de la cascade clientes)', async () => {
    // Crear consultora aislada con cliente. El INSERT del cliente dispara el
    // audit trigger -> row en audit_log con consultora_id. audit_log.consultora_id
    // tiene FK `on delete restrict` (tenancy.sql:73) -> hard-delete de
    // consultoras esta bloqueado mientras haya audit. Soft-delete UX usa
    // `archived_at`. La cascade clientes.consultora_id ON DELETE CASCADE existe
    // en el schema pero no se puede ejercitar end-to-end via DELETE de consultora
    // porque el audit DELETE de clientes (que se dispara mid-cascade) re-inserta
    // audit rows que el RESTRICT del FK bloquea (patron T-027 test 11).
    const slugTemp = `t047-cascade-${runId}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: tmpC } = await admin
      .from('consultoras')
      .insert({ name: 'T047 cascade temp', slug: slugTemp })
      .select('id')
      .single();

    const { data: cli } = await admin
      .from('clientes')
      .insert({
        consultora_id: tmpC!.id,
        razon_social: 'T047 cascade cliente',
        cuit: makeCuit(),
        created_by: ownerAId,
      })
      .select('id')
      .single();
    expect(cli?.id).toBeDefined();

    // DELETE consultora -> bloqueado por audit_log retention.
    const { error: deleteError } = await admin.from('consultoras').delete().eq('id', tmpC!.id);
    expect(deleteError).not.toBeNull();
    expect(deleteError?.message.toLowerCase()).toMatch(/foreign key|violates|restrict/);

    // Consultora sigue ahi (y el cliente tambien, todo intacto).
    const { data: still } = await admin
      .from('consultoras')
      .select('id')
      .eq('id', tmpC!.id)
      .maybeSingle();
    expect(still?.id).toBe(tmpC!.id);
  });
});
