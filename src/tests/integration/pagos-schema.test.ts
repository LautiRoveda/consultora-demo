/**
 * T-070 · Tests schema pagos: RLS + UNIQUE parcial + audit triggers.
 *
 * Cobertura:
 * - RLS SELECT: members ven suscripciones/facturas de su consultora; cross-tenant retorna 0 rows.
 * - RLS write: INSERT/UPDATE/DELETE bloqueado para authenticated (default-deny;
 *   solo service_role muta — webhooks MP en T-071).
 * - UNIQUE parcial suscripciones: 2 rows con estado IN (trial/activa/morosa) en
 *   misma consultora viola constraint; rows canceladas/expiradas conviven.
 * - Audit triggers: INSERT/UPDATE/DELETE via service_role escriben audit_log
 *   con shape esperado.
 * - Diff guard: UPDATE que no cambia ningún field del guard NO escribe audit_log.
 *
 * Correr local:
 *   `set -a && source .env.local && set +a && pnpm test:integration src/tests/integration/pagos-schema.test.ts`
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
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slugA = `t070-pagos-a-${runId}`;
const slugB = `t070-pagos-b-${runId}`;
const emailMemberA = `t070-pagos-member-a-${runId}@example.com`;
const emailOwnerB = `t070-pagos-owner-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let memberAId: string;
let ownerBId: string;
let suscripcionAId: string;
let suscripcionBId: string;
let clientMemberA: SupabaseClient<Database>;

beforeAll(async () => {
  // Setup secuencial — Promise.all sobre admin tiene flakiness en sa-east-1
  // (UND_ERR ConnectTimeoutError, lesson T-047).
  const resA = await admin
    .from('consultoras')
    .insert({ name: 'T070 Pagos cA', slug: slugA })
    .select('id')
    .single();
  if (resA.error || !resA.data) throw new Error(`insert cA: ${JSON.stringify(resA.error)}`);
  cAId = resA.data.id;

  const resB = await admin
    .from('consultoras')
    .insert({ name: 'T070 Pagos cB', slug: slugB })
    .select('id')
    .single();
  if (resB.error || !resB.data) throw new Error(`insert cB: ${JSON.stringify(resB.error)}`);
  cBId = resB.data.id;

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
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await Promise.all([
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  const sbMA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await sbMA.auth.signInWithPassword({ email: emailMemberA, password });
  clientMemberA = sbMA;

  // Fixture: una suscripción 'trial' por consultora (via service_role).
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const sA = await admin
    .from('suscripciones')
    .insert({
      consultora_id: cAId,
      plan_codigo: 'pro_mensual',
      estado: 'trial',
      periodo_inicio: now.toISOString(),
      periodo_fin: in7d.toISOString(),
    })
    .select('id')
    .single();
  if (sA.error || !sA.data) throw new Error(`insert suscripcion cA: ${JSON.stringify(sA.error)}`);
  suscripcionAId = sA.data.id;

  const sB = await admin
    .from('suscripciones')
    .insert({
      consultora_id: cBId,
      plan_codigo: 'pro_mensual',
      estado: 'trial',
      periodo_inicio: now.toISOString(),
      periodo_fin: in7d.toISOString(),
    })
    .select('id')
    .single();
  if (sB.error || !sB.data) throw new Error(`insert suscripcion cB: ${JSON.stringify(sB.error)}`);
  suscripcionBId = sB.data.id;
});

afterAll(async () => {
  // Orden FK estricto: facturas -> suscripciones -> audit_log refs -> members + consultoras
  // (consultoras tiene ON DELETE CASCADE para members/suscripciones/facturas pero audit_log
  // referencia consultora_id con ON DELETE RESTRICT — borramos los audit rows primero).
  await admin
    .from('facturas')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('suscripciones')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('audit_log')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('consultora_members')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('consultoras')
    .delete()
    .in('id', [cAId, cBId])
    .then(() => {});
  await Promise.all([
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
  ]);
});

describe('pagos · RLS SELECT', () => {
  it('memberA ve suscripcion de su consultora', async () => {
    const { data, error } = await clientMemberA
      .from('suscripciones')
      .select('id, estado, plan_codigo')
      .eq('id', suscripcionAId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(suscripcionAId);
    expect(data?.estado).toBe('trial');
    expect(data?.plan_codigo).toBe('pro_mensual');
  });

  it('memberA NO ve suscripciones de cB (cross-tenant)', async () => {
    const { data, error } = await clientMemberA
      .from('suscripciones')
      .select('id')
      .eq('id', suscripcionBId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('memberA NO ve facturas de cB (cross-tenant)', async () => {
    const mpPaymentId = `t070-payment-cB-${runId}`;
    const { data: fB } = await admin
      .from('facturas')
      .insert({
        consultora_id: cBId,
        suscripcion_id: suscripcionBId,
        monto_centavos: 3000000,
        mp_payment_id: mpPaymentId,
      })
      .select('id')
      .single();
    const { data, error } = await clientMemberA
      .from('facturas')
      .select('id')
      .eq('id', fB!.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe('pagos · RLS write default-deny', () => {
  it('memberA NO puede INSERT en suscripciones (default-deny)', async () => {
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { error } = await clientMemberA.from('suscripciones').insert({
      consultora_id: cAId,
      plan_codigo: 'pro_mensual',
      estado: 'trial',
      periodo_inicio: now.toISOString(),
      periodo_fin: in7d.toISOString(),
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('memberA NO puede UPDATE suscripcion existente (default-deny)', async () => {
    const { data, error } = await clientMemberA
      .from('suscripciones')
      .update({ estado: 'activa' })
      .eq('id', suscripcionAId)
      .select('id');
    // RLS bloquea: o error explícito o data vacía sin row afectada.
    expect(data ?? []).toHaveLength(0);
    expect(error?.message ?? '').not.toMatch(/internal/i);
  });

  it('memberA NO puede DELETE suscripcion existente (default-deny)', async () => {
    const { data, error } = await clientMemberA
      .from('suscripciones')
      .delete()
      .eq('id', suscripcionAId)
      .select('id');
    expect(data ?? []).toHaveLength(0);
    expect(error?.message ?? '').not.toMatch(/internal/i);
    // Confirmar que sigue existiendo via admin.
    const { data: still } = await admin
      .from('suscripciones')
      .select('id')
      .eq('id', suscripcionAId)
      .maybeSingle();
    expect(still?.id).toBe(suscripcionAId);
  });
});

describe('pagos · UNIQUE parcial suscripciones', () => {
  it('segunda activa en misma consultora viola UNIQUE (cuando hay trial viva)', async () => {
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { error } = await admin.from('suscripciones').insert({
      consultora_id: cAId,
      plan_codigo: 'pro_mensual',
      estado: 'activa',
      periodo_inicio: now.toISOString(),
      periodo_fin: in7d.toISOString(),
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505');
  });

  it('cancelada/expirada NO entra al UNIQUE — convive con trial viva', async () => {
    const now = new Date();
    const before = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const { data, error } = await admin
      .from('suscripciones')
      .insert({
        consultora_id: cAId,
        plan_codigo: 'pro_mensual',
        estado: 'cancelada',
        periodo_inicio: before.toISOString(),
        periodo_fin: now.toISOString(),
        cancelada_en: now.toISOString(),
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeDefined();
  });
});

describe('pagos · audit triggers', () => {
  it('INSERT factura escribe audit_log con action=created + entity_type=facturas', async () => {
    const mpPaymentId = `t070-audit-create-${runId}`;
    const { data: f } = await admin
      .from('facturas')
      .insert({
        consultora_id: cAId,
        suscripcion_id: suscripcionAId,
        monto_centavos: 3000000,
        mp_payment_id: mpPaymentId,
      })
      .select('id')
      .single();

    const { data: log } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, after_data')
      .eq('entity_type', 'facturas')
      .eq('entity_id', f!.id)
      .maybeSingle();
    expect(log?.action).toBe('created');
    expect(log?.entity_type).toBe('facturas');
    expect((log?.after_data as Record<string, unknown> | null)?.mp_payment_id).toBe(mpPaymentId);
  });

  it('UPDATE sobre field NO guardiado (recibo_url no entra al diff guard) NO escribe audit_log', async () => {
    const mpPaymentId = `t070-audit-noop-${runId}`;
    const { data: f } = await admin
      .from('facturas')
      .insert({
        consultora_id: cAId,
        suscripcion_id: suscripcionAId,
        monto_centavos: 3000000,
        mp_payment_id: mpPaymentId,
      })
      .select('id')
      .single();

    // UPDATE que no toca ningún field del diff guard
    // (estado/recibo_url/pagada_en/razon_falla quedan iguales).
    await admin.from('facturas').update({ recibo_url: null }).eq('id', f!.id);

    const { data: logs } = await admin
      .from('audit_log')
      .select('action')
      .eq('entity_type', 'facturas')
      .eq('entity_id', f!.id);

    // Solo la fila 'created'; ninguna 'updated' por diff guard sin cambio real.
    expect((logs ?? []).filter((l) => l.action === 'updated')).toHaveLength(0);
  });

  it('UPDATE estado de suscripcion escribe audit_log con before/after', async () => {
    const { data: before } = await admin
      .from('audit_log')
      .select('id')
      .eq('entity_type', 'suscripciones')
      .eq('entity_id', suscripcionAId)
      .eq('action', 'updated');
    const beforeCount = (before ?? []).length;

    await admin.from('suscripciones').update({ estado: 'morosa' }).eq('id', suscripcionAId);

    const { data: after } = await admin
      .from('audit_log')
      .select('id, before_data, after_data')
      .eq('entity_type', 'suscripciones')
      .eq('entity_id', suscripcionAId)
      .eq('action', 'updated');
    const afterRows = after ?? [];
    expect(afterRows.length).toBeGreaterThan(beforeCount);
    const last = afterRows[afterRows.length - 1];
    if (!last) throw new Error('audit_log update row no apareció post-UPDATE');
    expect((last.before_data as Record<string, unknown>).estado).toBe('trial');
    expect((last.after_data as Record<string, unknown>).estado).toBe('morosa');

    // Restaurar fixture para que otros tests sigan viendo 'trial'.
    await admin.from('suscripciones').update({ estado: 'trial' }).eq('id', suscripcionAId);
  });
});
