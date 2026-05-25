/**
 * CHORE-C · Integration tests para watchdog dunning recovery.
 *
 * Cobertura POST /api/cron/billing-dunning-recovery:
 *  1. Auth sin header -> 401.
 *  2. Auth header invalido -> 401.
 *  3. Happy path: row stale trial_expires_in_3d -> recovered + resend_email_id seteado.
 *  4. Row reciente (<5min) NO se procesa (sigue NULL).
 *  5. Row ya enviada (resend_email_id non-null) ignorada.
 *  6. Row con `failed:*` persistente ignorada.
 *  7. consultora_deleted: SKIP (unreachable por FK cascade, ver comentario).
 *  8. Owner email null -> failed:no_owner_email.
 *  9. payment_failed con factura existente -> recovered + idempotencyKey con ref_id.
 *  10. payment_failed con factura borrada -> failed:ref_not_found.
 *  11. subscription_cancelled con ref_id `local:*` -> query por consultora_id.
 *  12. Resend devuelve error -> failed:resend_*.
 *  13. LIMIT 50: 60 rows stale -> max 50 procesadas en un tick.
 *  14. idempotencyKey trial_* matchea formato del cron principal.
 *  15. Anti-PII: response body no contiene `@` (invariante forward).
 *
 * Mocks: server-only, resend.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test src/tests/integration/billing-dunning-recovery.test.ts`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/cron/billing-dunning-recovery/route';

vi.mock('server-only', () => ({}));

const mockEmailsSend = vi.fn();
vi.mock('@/shared/notifications/resend', () => ({
  getResendClient: () => ({
    emails: { send: mockEmailsSend },
  }),
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.INTERNAL_CRON_SECRET;

if (!url || !serviceKey || !cronSecret) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTERNAL_CRON_SECRET.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ENDPOINT_URL = 'http://localhost/api/cron/billing-dunning-recovery';
const TEN_MIN_AGO = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();
const TWO_MIN_AGO = () => new Date(Date.now() - 2 * 60 * 1000).toISOString();
const ONE_HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

type ConsultoraFixture = {
  id: string;
  name: string;
  ownerId: string;
  email: string;
};

const fixtures: {
  withOwner?: ConsultoraFixture; // trial-* + Resend-error tests
  withOwnerPayment?: ConsultoraFixture & { suscripcionId: string; mpPaymentId: string };
  withOwnerLocalSub?: ConsultoraFixture & { suscripcionId: string };
  withOwnerBulk?: { id: string }; // sin owner -> all rows marcan failed:no_owner_email
  noOwner?: { id: string };
} = {};

async function createConsultoraWithOwner(prefix: string): Promise<ConsultoraFixture> {
  const slug = `chorec-${prefix}-${runId}`;
  const email = `chorec-${prefix}-${runId}@example.com`;
  const name = `CHORE-C ${prefix}`;
  const { data: c, error: cErr } = await admin
    .from('consultoras')
    .insert({ name, slug, plan: 'trial' })
    .select('id, name')
    .single();
  if (cErr) throw cErr;
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password: 'TestPassword123!',
    email_confirm: true,
  });
  const ownerId = u.user!.id;
  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: c.id, role: 'owner' });
  return { id: c.id, name: c.name, ownerId, email };
}

function postReq(secret = cronSecret): NextRequest {
  return new NextRequest(ENDPOINT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Internal-Cron-Secret': secret } : {}),
    },
    body: '{}',
  });
}

async function insertLogRow(args: {
  consultoraId: string;
  tipo: Database['public']['Tables']['billing_notifications_log']['Row']['tipo'];
  refId?: string | null;
  resendEmailId?: string | null;
  createdAt?: string;
}): Promise<string> {
  // created_at on INSERT (no UPDATE post-insert): AUD-001 trigger refinado
  // (CHORE-C) sólo permite UPDATE de resend_email_id NULL → non-NULL, así
  // que cualquier otro UPDATE — incluyendo created_at — rebota.
  const { data, error } = await admin
    .from('billing_notifications_log')
    .insert({
      consultora_id: args.consultoraId,
      tipo: args.tipo,
      ref_id: args.refId ?? null,
      resend_email_id: args.resendEmailId ?? null,
      ...(args.createdAt ? { created_at: args.createdAt } : {}),
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function neutralizeLegacyStaleRows(): Promise<void> {
  // Pre-test sweep: rows con resend_email_id NULL + created_at < 5min de
  // runs previos compiten con nuestros tests por slots del LIMIT 50. El
  // watchdog filtra rows < 5min, asi que el cutoff "todo lo procesable
  // por el watchdog" es exactamente created_at < now()-5min. Marcamos
  // failed:legacy_test_cleanup (transición legítima NULL → non-NULL bajo
  // AUD-001 refinado). NO usamos DELETE: el trigger AUD-001 lo bloquea
  // (append-only audit).
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: stale } = await admin
    .from('billing_notifications_log')
    .select('id')
    .is('resend_email_id', null)
    .lt('created_at', cutoff);
  for (const row of stale ?? []) {
    await admin
      .from('billing_notifications_log')
      .update({ resend_email_id: 'failed:legacy_test_cleanup' })
      .eq('id', row.id);
  }
}

beforeAll(async () => {
  await neutralizeLegacyStaleRows();
  fixtures.withOwner = await createConsultoraWithOwner('owner');
  fixtures.withOwnerPayment = {
    ...(await createConsultoraWithOwner('payment')),
    suscripcionId: '',
    mpPaymentId: `mp-pay-chorec-${runId}`,
  };
  fixtures.withOwnerLocalSub = {
    ...(await createConsultoraWithOwner('localsub')),
    suscripcionId: '',
  };

  // Crear suscripcion + factura para withOwnerPayment.
  const { data: subP, error: subPErr } = await admin
    .from('suscripciones')
    .insert({
      consultora_id: fixtures.withOwnerPayment.id,
      plan_codigo: 'pro_mensual',
      estado: 'cancelada',
      mp_subscription_id: `mp-sub-chorec-pay-${runId}`,
      periodo_inicio: new Date().toISOString(),
      periodo_fin: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    })
    .select('id')
    .single();
  if (subPErr) throw subPErr;
  fixtures.withOwnerPayment.suscripcionId = subP.id;

  await admin.from('facturas').insert({
    consultora_id: fixtures.withOwnerPayment.id,
    suscripcion_id: subP.id,
    monto_centavos: 3_000_000,
    moneda: 'ARS',
    estado: 'fallida',
    mp_payment_id: fixtures.withOwnerPayment.mpPaymentId,
    razon_falla: 'cc_rejected_insufficient_amount',
  });

  // Suscripcion sin mp_subscription_id para test #11 (local:*).
  const { data: subL, error: subLErr } = await admin
    .from('suscripciones')
    .insert({
      consultora_id: fixtures.withOwnerLocalSub.id,
      plan_codigo: 'pro_mensual',
      estado: 'cancelada',
      mp_subscription_id: null,
      cancelar_en: '2026-07-15T00:00:00Z',
      periodo_inicio: new Date().toISOString(),
      periodo_fin: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    })
    .select('id')
    .single();
  if (subLErr) throw subLErr;
  fixtures.withOwnerLocalSub.suscripcionId = subL.id;

  // Bulk consultora SIN owner -> rows en LIMIT 50 test caen en failed:no_owner_email.
  const slugBulk = `chorec-bulk-${runId}`;
  const { data: cBulk } = await admin
    .from('consultoras')
    .insert({ name: 'CHORE-C bulk', slug: slugBulk, plan: 'trial' })
    .select('id')
    .single();
  fixtures.withOwnerBulk = { id: cBulk!.id };

  const slugNoOwner = `chorec-no-owner-${runId}`;
  const { data: cNoOwner } = await admin
    .from('consultoras')
    .insert({ name: 'CHORE-C no owner', slug: slugNoOwner, plan: 'trial' })
    .select('id')
    .single();
  fixtures.noOwner = { id: cNoOwner!.id };
});

afterAll(async () => {
  // AUD-001 trigger bloquea DELETE en billing_notifications_log → cascade
  // DELETE de consultora rebota. Mismo patron que audit-followup.test.ts:
  // dejamos las rows de fixture en DB de testing (cleanup admin manual via
  // slug `chorec-*-${runId}`). Solo limpiamos auth users + facturas/suscripciones
  // (que sí permiten DELETE). Las rows del log quedan con resend_email_id
  // marcado por los propios tests (cualquier valor non-NULL las saca del
  // radar del watchdog).
  if (fixtures.withOwnerPayment?.id) {
    await admin
      .from('facturas')
      .delete()
      .eq('mp_payment_id', fixtures.withOwnerPayment.mpPaymentId);
    await admin.from('suscripciones').delete().eq('consultora_id', fixtures.withOwnerPayment.id);
  }
  if (fixtures.withOwnerLocalSub?.id) {
    await admin.from('suscripciones').delete().eq('consultora_id', fixtures.withOwnerLocalSub.id);
  }
  for (const f of [fixtures.withOwner, fixtures.withOwnerPayment, fixtures.withOwnerLocalSub]) {
    if (f?.ownerId) await admin.auth.admin.deleteUser(f.ownerId).catch(() => {});
  }
});

beforeEach(() => {
  mockEmailsSend.mockReset();
  mockEmailsSend.mockImplementation(() =>
    Promise.resolve({
      data: { id: `rsd_recovery_${Math.random().toString(36).slice(2, 8)}` },
      error: null,
    }),
  );
  // No cleanup de log rows entre tests: el trigger AUD-001 bloquea DELETE.
  // Tests usan ref_ids distintos para no colisionar en el UNIQUE compuesto
  // (consultora_id, tipo, ref_id) — ver constantes REF_* abajo.
});

describe('POST /api/cron/billing-dunning-recovery · auth', () => {
  it('1. sin header X-Internal-Cron-Secret -> 401', async () => {
    const res = await POST(postReq(''));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('2. header invalido -> 401', async () => {
    const res = await POST(postReq('wrong-secret'));
    expect(res.status).toBe(401);
  });
});

// Ref_ids distintos por test para no colisionar en el UNIQUE compuesto
// (consultora_id, tipo, ref_id) — el trigger AUD-001 refinado bloquea
// DELETE, asi que no hay cleanup entre tests. Cada test reserva su slot
// dedicado. Para trial_*, el watchdog ignora ref_id en idempotencyKey
// (mismo formato que el cron principal: `${id}:${tipo}`), asi que el ref_id
// del test no contamina las asserciones.
const REF = {
  t3: `t3-${runId}`,
  t5: `t5-${runId}`,
  t6: `t6-${runId}`,
  t12: `t12-${runId}`,
  t14: `t14-${runId}`,
  t15: `t15-${runId}`,
};

describe('billing-dunning-recovery · stale rows', () => {
  it('3. happy path trial_expires_in_3d stale -> recovered + resend_email_id seteado', async () => {
    const f = fixtures.withOwner!;
    const logId = await insertLogRow({
      consultoraId: f.id,
      tipo: 'trial_expires_in_3d',
      refId: REF.t3,
      resendEmailId: null,
      createdAt: TEN_MIN_AGO(),
    });

    const res = await POST(postReq());
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('billing_notifications_log')
      .select('resend_email_id')
      .eq('id', logId)
      .single();
    expect(row!.resend_email_id).toMatch(/^rsd_recovery_/);

    const ourCall = mockEmailsSend.mock.calls.find((c) => c[0]?.to === f.email);
    expect(ourCall).toBeDefined();
    expect(ourCall![0].subject).toContain('Tu trial vence en 3 días');
  });

  it('4. row reciente (<5min) NO se procesa (sigue NULL)', async () => {
    const f = fixtures.withOwner!;
    const logId = await insertLogRow({
      consultoraId: f.id,
      tipo: 'trial_expires_in_1d',
      refId: null,
      resendEmailId: null,
      createdAt: TWO_MIN_AGO(),
    });

    await POST(postReq());

    const { data: row } = await admin
      .from('billing_notifications_log')
      .select('resend_email_id')
      .eq('id', logId)
      .single();
    expect(row!.resend_email_id).toBeNull();

    const ourCall = mockEmailsSend.mock.calls.find((c) => c[0]?.to === f.email);
    expect(ourCall).toBeUndefined();
  });

  it('5. row ya enviada (resend_email_id non-null) ignorada', async () => {
    const f = fixtures.withOwner!;
    const logId = await insertLogRow({
      consultoraId: f.id,
      tipo: 'trial_expired',
      refId: REF.t5,
      resendEmailId: 'rsd_already_sent_xyz',
      createdAt: TEN_MIN_AGO(),
    });

    await POST(postReq());

    const { data: row } = await admin
      .from('billing_notifications_log')
      .select('resend_email_id')
      .eq('id', logId)
      .single();
    expect(row!.resend_email_id).toBe('rsd_already_sent_xyz');
  });

  it('6. row con `failed:*` persistente ignorada', async () => {
    const f = fixtures.withOwner!;
    const logId = await insertLogRow({
      consultoraId: f.id,
      tipo: 'trial_expired',
      refId: REF.t6,
      resendEmailId: 'failed:bounced',
      createdAt: TEN_MIN_AGO(),
    });

    await POST(postReq());

    const { data: row } = await admin
      .from('billing_notifications_log')
      .select('resend_email_id')
      .eq('id', logId)
      .single();
    expect(row!.resend_email_id).toBe('failed:bounced');
  });

  // Unreachable hoy por FK cascade en billing_notifications_log.consultora_id
  // (+ trigger AUD-001 también bloquea cascade DELETE, doble candado);
  // cableado defensivo por si consultoras pasa a soft-delete forward
  // (CHORE-D-FU o T-Compliance). Cuando llegue ese cambio, este test pasa
  // a it() normal usando el path soft-delete.
  it.skip('7. consultora deleted -> failed:consultora_deleted (unreachable hoy, ver comentario)', () => {});

  it('8. owner email null -> failed:no_owner_email', async () => {
    const f = fixtures.noOwner!;
    const logId = await insertLogRow({
      consultoraId: f.id,
      tipo: 'trial_expires_in_3d',
      refId: null,
      resendEmailId: null,
      createdAt: TEN_MIN_AGO(),
    });

    await POST(postReq());

    const { data: row } = await admin
      .from('billing_notifications_log')
      .select('resend_email_id')
      .eq('id', logId)
      .single();
    expect(row!.resend_email_id).toBe('failed:no_owner_email');
  });
});

describe('billing-dunning-recovery · payment_failed', () => {
  it('9. factura existente -> recovered + idempotencyKey con mp_payment_id', async () => {
    const f = fixtures.withOwnerPayment!;
    const logId = await insertLogRow({
      consultoraId: f.id,
      tipo: 'payment_failed',
      refId: f.mpPaymentId,
      resendEmailId: null,
      createdAt: TEN_MIN_AGO(),
    });

    await POST(postReq());

    const { data: row } = await admin
      .from('billing_notifications_log')
      .select('resend_email_id')
      .eq('id', logId)
      .single();
    expect(row!.resend_email_id).toMatch(/^rsd_recovery_/);

    const ourCall = mockEmailsSend.mock.calls.find((c) => c[0]?.to === f.email);
    expect(ourCall).toBeDefined();
    expect(ourCall![1]?.idempotencyKey).toBe(`${f.id}:payment_failed:${f.mpPaymentId}`);
  });

  it('10. factura borrada -> failed:ref_not_found', async () => {
    const f = fixtures.withOwnerPayment!;
    const logId = await insertLogRow({
      consultoraId: f.id,
      tipo: 'payment_failed',
      refId: `mp-pay-INEXISTENTE-${runId}`,
      resendEmailId: null,
      createdAt: TEN_MIN_AGO(),
    });

    await POST(postReq());

    const { data: row } = await admin
      .from('billing_notifications_log')
      .select('resend_email_id')
      .eq('id', logId)
      .single();
    expect(row!.resend_email_id).toBe('failed:ref_not_found');
  });
});

describe('billing-dunning-recovery · subscription_cancelled', () => {
  it('11. ref_id `local:*` -> query por consultora_id + recovered', async () => {
    const f = fixtures.withOwnerLocalSub!;
    const refId = `local:${f.id}`;
    const logId = await insertLogRow({
      consultoraId: f.id,
      tipo: 'subscription_cancelled',
      refId,
      resendEmailId: null,
      createdAt: TEN_MIN_AGO(),
    });

    await POST(postReq());

    const { data: row } = await admin
      .from('billing_notifications_log')
      .select('resend_email_id')
      .eq('id', logId)
      .single();
    expect(row!.resend_email_id).toMatch(/^rsd_recovery_/);

    const ourCall = mockEmailsSend.mock.calls.find((c) => c[0]?.to === f.email);
    expect(ourCall).toBeDefined();
    expect(ourCall![1]?.idempotencyKey).toBe(`${f.id}:subscription_cancelled:${refId}`);
    // T-085 format-date helper renderiza en TZ AR (-3). cancelar_en=
    // '2026-07-15T00:00:00Z' -> 14/07/2026 21:00 ART. La asercion matchea
    // el rendering AR. Si el contrato del template cambia (ej: forzar UTC),
    // este expected se actualiza.
    expect(ourCall![0].html).toContain('14/07/2026');
  });
});

describe('billing-dunning-recovery · resend errors', () => {
  it('12. Resend devuelve error -> failed:resend_*', async () => {
    const f = fixtures.withOwner!;
    mockEmailsSend.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { name: 'validation_error', message: 'bad addr' } }),
    );

    const logId = await insertLogRow({
      consultoraId: f.id,
      tipo: 'trial_expires_in_3d',
      refId: REF.t12,
      resendEmailId: null,
      createdAt: TEN_MIN_AGO(),
    });

    await POST(postReq());

    const { data: row } = await admin
      .from('billing_notifications_log')
      .select('resend_email_id')
      .eq('id', logId)
      .single();
    expect(row!.resend_email_id).toBe('failed:resend_validation_error');
  });
});

describe('billing-dunning-recovery · batch limit', () => {
  it('13. 60 rows stale -> max 50 procesadas en un tick', async () => {
    const f = fixtures.withOwnerBulk!;
    // 60 rows tipo=payment_failed con ref_ids distintos. withOwnerBulk no
    // tiene owner -> watchdog marca todas failed:no_owner_email (NON-NULL,
    // suficiente para la asercion). created_at = 1hr atras (INSERT-only,
    // AUD-001 bloquea UPDATE) las prioriza en el orden ASC sobre los rows
    // TEN_MIN_AGO de otros tests.
    const ts = ONE_HOUR_AGO();
    const rows = Array.from({ length: 60 }, (_, i) => ({
      consultora_id: f.id,
      tipo: 'payment_failed' as const,
      ref_id: `mp-bulk-${runId}-${i.toString().padStart(3, '0')}`,
      resend_email_id: null,
      created_at: ts,
    }));
    const { error: insErr } = await admin.from('billing_notifications_log').insert(rows);
    if (insErr) throw insErr;

    await POST(postReq());

    const { data: stillNull } = await admin
      .from('billing_notifications_log')
      .select('id')
      .eq('consultora_id', f.id)
      .is('resend_email_id', null);
    const { data: processed } = await admin
      .from('billing_notifications_log')
      .select('id')
      .eq('consultora_id', f.id)
      .not('resend_email_id', 'is', null);

    expect(processed!.length).toBe(50);
    expect(stillNull!.length).toBe(10);
  });
});

describe('billing-dunning-recovery · idempotencyKey + anti-PII', () => {
  it('14. idempotencyKey trial_expires_in_3d matchea formato del cron principal', async () => {
    const f = fixtures.withOwner!;
    await insertLogRow({
      consultoraId: f.id,
      tipo: 'trial_expires_in_3d',
      refId: REF.t14,
      resendEmailId: null,
      createdAt: TEN_MIN_AGO(),
    });

    await POST(postReq());

    const ourCall = mockEmailsSend.mock.calls.find((c) => c[0]?.to === f.email);
    expect(ourCall).toBeDefined();
    expect(ourCall![1]?.idempotencyKey).toBe(`${f.id}:trial_expires_in_3d`);
  });

  it('15. anti-PII: response body NO contiene `@` (invariante forward)', async () => {
    const f = fixtures.withOwner!;
    mockEmailsSend.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { name: 'validation_error', message: 'bad addr' } }),
    );

    await insertLogRow({
      consultoraId: f.id,
      tipo: 'trial_expired',
      refId: REF.t15,
      resendEmailId: null,
      createdAt: TEN_MIN_AGO(),
    });

    const res = await POST(postReq());
    const body = await res.json();
    const raw = JSON.stringify(body);
    // Si alguien refactorea `reason` a `err.message` y leakea email del owner,
    // este assertion rompe. Tag generico `resend_validation_error` no contiene `@`.
    expect(/[^\s]@[^\s]/.test(raw)).toBe(false);
    expect(Array.isArray(body.errors)).toBe(true);
    const ourErr = body.errors.find((e: { reason: string }) => e.reason.startsWith('resend_'));
    expect(ourErr?.reason).toBe('resend_validation_error');
  });
});
