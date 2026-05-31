/**
 * T-111 F2 · Test de la función admin_cleanup_test_consultoras en el stack local
 * efímero (job integration). Verifica los 4 criterios:
 *  1. PROTEGIDA (member ≠ @example) + su audit_log + hijas INTACTOS.
 *  2. TEST (en p_ids) BORRADA: consultora + TODAS las hijas + audit_log +
 *     notification_log + billing_notifications_log + informe_metadata (nivel-2
 *     SIN consultora_id, el leak que motivó la FK-reachability).
 *  3. RESIDUAL (no en p_ids) INTACTO.
 *  4. CONSISTENCIA: cero filas de TEST en toda tabla alcanzable (consultora_id
 *     directo + informe_metadata vía su FK).
 *
 * La función vive en la migración 20260531000002 (aplicada por db reset en el
 * stack local). NO está en los tipos generados (db:types --linked no la ve hasta
 * el cleanup de prod), por eso el rpc va casteado.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Tests requieren env Supabase.');

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// La función no está en Database['Functions'] (vive solo en la migración F2).
type CleanupRow = { tabla: string; filas_borradas: number };
const rpcCleanup = admin.rpc as unknown as (
  fn: 'admin_cleanup_test_consultoras',
  args: { p_ids: string[] },
) => PromiseLike<{ data: CleanupRow[] | null; error: { message: string } | null }>;

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Tenant = {
  consultoraId: string;
  ownerId: string | null;
  informeMetadataId: string | null; // = informe_id (PK de informe_metadata)
};

let P: Tenant; // protegida (@gmail)
let T: Tenant; // test (@example) -> se borra
let residualId: string; // orphan, no en p_ids

async function seedTenant(tag: string, ownerEmail: string | null): Promise<Tenant> {
  const consultoraId = (
    await admin
      .from('consultoras')
      .insert({ name: `T111F2 ${tag}`, slug: `t111f2-${tag}-${runId}` })
      .select('id')
      .single()
  ).data!.id;

  let ownerId: string | null = null;
  if (ownerEmail) {
    ownerId = (
      await admin.auth.admin.createUser({
        email: ownerEmail,
        password: 'TestPassword123!',
        email_confirm: true,
      })
    ).data.user!.id;
    await admin
      .from('consultora_members')
      .insert({ user_id: ownerId, consultora_id: consultoraId, role: 'owner' });
  }

  const clienteId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        razon_social: `Cliente ${tag} ${runId}`,
        cuit: `30-${Date.now().toString().slice(-8).padStart(8, '0')}-${tag === 'p' ? '1' : '2'}`,
        created_by: ownerId,
      })
      .select('id')
      .single()
  ).data!.id;

  await admin.from('empleados').insert({
    consultora_id: consultoraId,
    cliente_id: clienteId,
    nombre: 'Juan',
    apellido: `Test-${tag}`,
    dni: tag === 'p' ? '20111222' : '20333444',
    created_by: ownerId,
  });

  // informe + informe_metadata (nivel-2 SIN consultora_id: el caso clave).
  const informeId = (
    await admin
      .from('informes')
      .insert({
        consultora_id: consultoraId,
        tipo: 'rgrl',
        titulo: `Informe ${tag}`,
        created_by: ownerId,
      })
      .select('id')
      .single()
  ).data!.id;
  await admin.from('informe_metadata').insert({ informe_id: informeId, data: {} });

  // notification_log + billing_notifications_log (RESTRICT + el segundo immutable).
  await admin
    .from('notification_log')
    .insert({ consultora_id: consultoraId, channel: 'email', status: 'sent' });
  await admin
    .from('billing_notifications_log')
    .insert({ consultora_id: consultoraId, tipo: 'trial_expired' });

  return { consultoraId, ownerId, informeMetadataId: informeId };
}

beforeAll(async () => {
  P = await seedTenant('p', `real-${runId}@gmail.com`);
  T = await seedTenant('t', `test-${runId}@example.com`);
  residualId = (
    await admin
      .from('consultoras')
      .insert({ name: `T111F2 residual`, slug: `zzz-residual-${runId}` })
      .select('id')
      .single()
  ).data!.id;
});

afterAll(async () => {
  // Dogfooding: limpiamos P + residual con la misma función (T ya está borrada).
  await rpcCleanup('admin_cleanup_test_consultoras', { p_ids: [P.consultoraId, residualId] });
  if (P.ownerId) await admin.auth.admin.deleteUser(P.ownerId).catch(() => {});
  if (T.ownerId) await admin.auth.admin.deleteUser(T.ownerId).catch(() => {});
});

// Cliente "loose" para contar sobre tablas elegidas dinámicamente en el test,
// sin pelear con los tipos estrictos por-tabla (no usamos `any`).
type LooseCountQuery = {
  select: (
    c: string,
    o: { count: 'exact'; head: true },
  ) => { eq: (col: string, val: string) => PromiseLike<{ count: number | null }> };
};
const adminLoose = admin as unknown as { from: (t: string) => LooseCountQuery };

async function count(table: string, col: string, val: string): Promise<number> {
  const { count: c } = await adminLoose
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(col, val);
  return c ?? 0;
}

describe('admin_cleanup_test_consultoras', () => {
  it('borra TEST por completo (incl. informe_metadata), preserva PROTEGIDA y RESIDUAL', async () => {
    // audit_log de TEST y PROTEGIDA debe existir pre-cleanup (triggers de inserts).
    expect(await count('audit_log', 'consultora_id', T.consultoraId)).toBeGreaterThan(0);
    const protegidaAuditPre = await count('audit_log', 'consultora_id', P.consultoraId);
    expect(protegidaAuditPre).toBeGreaterThan(0);

    // --- Cleanup SOLO de TEST ---
    const { data: report, error } = await rpcCleanup('admin_cleanup_test_consultoras', {
      p_ids: [T.consultoraId],
    });
    expect(error).toBeNull();
    expect(report).not.toBeNull();
    const byTable = new Map((report ?? []).map((r) => [r.tabla, r.filas_borradas]));
    // Criterio nivel-2: informe_metadata fue borrada por Fase A (no quedó huérfana).
    expect(byTable.get('informe_metadata') ?? 0).toBeGreaterThanOrEqual(1);
    expect(byTable.get('consultoras') ?? 0).toBe(1);

    // --- (2) TEST borrada: consultora + todas las hijas + logs + informe_metadata ---
    expect(await count('consultoras', 'id', T.consultoraId)).toBe(0);
    for (const tbl of [
      'clientes',
      'empleados',
      'informes',
      'audit_log',
      'notification_log',
      'billing_notifications_log',
      'consultora_members',
    ]) {
      expect(await count(tbl, 'consultora_id', T.consultoraId)).toBe(0);
    }
    // informe_metadata (sin consultora_id) -> por su PK informe_id sembrado.
    expect(await count('informe_metadata', 'informe_id', T.informeMetadataId!)).toBe(0);

    // --- (1) PROTEGIDA + su audit_log + hijas INTACTOS ---
    expect(await count('consultoras', 'id', P.consultoraId)).toBe(1);
    expect(await count('audit_log', 'consultora_id', P.consultoraId)).toBe(protegidaAuditPre);
    expect(await count('clientes', 'consultora_id', P.consultoraId)).toBeGreaterThan(0);
    expect(await count('informe_metadata', 'informe_id', P.informeMetadataId!)).toBe(1);

    // --- (3) RESIDUAL INTACTO (no estaba en p_ids) ---
    expect(await count('consultoras', 'id', residualId)).toBe(1);

    // --- (4) CONSISTENCIA: cero filas de TEST en TODA tabla alcanzable ---
    // nivel-1 (consultora_id) ya cubierto arriba; reconfirmamos el set + nivel-2.
    for (const tbl of [
      'clientes',
      'empleados',
      'informes',
      'epp_entregas',
      'calendar_events',
      'audit_log',
      'notification_log',
      'billing_notifications_log',
    ]) {
      expect(await count(tbl, 'consultora_id', T.consultoraId)).toBe(0);
    }
    expect(await count('informe_metadata', 'informe_id', T.informeMetadataId!)).toBe(0);
  });
});
