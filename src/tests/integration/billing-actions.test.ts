/**
 * T-071 · Integration tests de las server actions de billing.
 *
 * Cobertura:
 *  1. createSubscriptionAction sin auth → UNAUTHENTICATED.
 *  2. createSubscriptionAction como member non-owner → FORBIDDEN_NOT_OWNER.
 *  3. createSubscriptionAction owner happy → ok:true + initPoint + fila
 *     suscripciones estado='pendiente_autorizacion' + mp_subscription_id.
 *  4. createSubscriptionAction con suscripcion activa existente → DUPLICATE_SUBSCRIPTION.
 *  5. createSubscriptionAction con MP API error → MP_API_ERROR.
 *  6. cancelSubscriptionAction sin auth → UNAUTHENTICATED.
 *  7. cancelSubscriptionAction id no-uuid → INVALID_INPUT.
 *  8. cancelSubscriptionAction id de otra consultora → NOT_FOUND (RLS filtra).
 *  9. cancelSubscriptionAction owner happy → MP cancel called + cancelar_en set.
 * 10. cancelSubscriptionAction sobre sub sin mp_subscription_id → NOT_CANCELABLE.
 *
 * Mocks:
 *  - @/shared/mercadopago/client: createPreapproval + cancelPreapproval
 *    devuelven payloads controlados (NO MP real).
 *  - server-only / next/headers / next/cache: idem patrón clientes-actions.test.ts.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
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

const createPreapprovalMock = vi.fn();
const cancelPreapprovalMock = vi.fn();
vi.mock('@/shared/mercadopago/client', async () => {
  const actual = await vi.importActual<typeof import('@/shared/mercadopago/client')>(
    '@/shared/mercadopago/client',
  );
  return {
    ...actual,
    createPreapproval: (...args: unknown[]) => createPreapprovalMock(...args),
    cancelPreapproval: (...args: unknown[]) => cancelPreapprovalMock(...args),
  };
});

const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerInfoMock = vi.fn();
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: () => {},
    debug: () => {},
    info: (arg: unknown, msg?: string) => loggerInfoMock(arg, msg),
    warn: (arg: unknown, msg?: string) => loggerWarnMock(arg, msg),
    error: (arg: unknown, msg?: string) => loggerErrorMock(arg, msg),
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

const slugA = `t071a-${runId}`;
const slugB = `t071b-${runId}`;
const emailOwnerA = `t071a-own-${runId}@example.com`;
const emailMemberA = `t071a-mem-${runId}@example.com`;
const emailOwnerB = `t071b-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let subBId: string;

beforeAll(async () => {
  // Setup SECUENCIAL — lesson T-047 (Promise.all flaky sa-east-1).
  const { data: cA, error: errCA } = await admin
    .from('consultoras')
    .insert({ name: 'T071A', slug: slugA })
    .select('id')
    .single();
  if (errCA) throw errCA;
  cAId = cA.id;

  const { data: cB, error: errCB } = await admin
    .from('consultoras')
    .insert({ name: 'T071B', slug: slugB })
    .select('id')
    .single();
  if (errCB) throw errCB;
  cBId = cB.id;

  const { data: uOA, error: errUOA } = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  if (errUOA) throw errUOA;
  ownerAId = uOA.user.id;

  const { data: uMA, error: errUMA } = await admin.auth.admin.createUser({
    email: emailMemberA,
    password,
    email_confirm: true,
  });
  if (errUMA) throw errUMA;
  memberAId = uMA.user.id;

  const { data: uOB, error: errUOB } = await admin.auth.admin.createUser({
    email: emailOwnerB,
    password,
    email_confirm: true,
  });
  if (errUOB) throw errUOB;
  ownerBId = uOB.user.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } });

  // Sub en consultora B con mp_subscription_id — usada para cross-tenant
  // NOT_FOUND test.
  const { data: subB, error: subBErr } = await admin
    .from('suscripciones')
    .insert({
      consultora_id: cBId,
      plan_codigo: 'pro_mensual',
      estado: 'activa',
      mp_subscription_id: `mp-pre-${runId}-B`,
      periodo_inicio: new Date().toISOString(),
      periodo_fin: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    })
    .select('id')
    .single();
  if (subBErr) throw subBErr;
  subBId = subB.id;
});

afterAll(async () => {
  await admin.from('facturas').delete().eq('consultora_id', cAId);
  await admin.from('facturas').delete().eq('consultora_id', cBId);
  await admin.from('suscripciones').delete().eq('consultora_id', cAId);
  await admin.from('suscripciones').delete().eq('consultora_id', cBId);
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(memberAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
});

beforeEach(async () => {
  cookieStore.length = 0;
  createPreapprovalMock.mockReset();
  cancelPreapprovalMock.mockReset();
  loggerWarnMock.mockClear();
  loggerErrorMock.mockClear();
  loggerInfoMock.mockClear();
  // Limpiar suscripciones de consultora A entre tests (B la dejamos viva).
  await admin.from('facturas').delete().eq('consultora_id', cAId);
  await admin.from('suscripciones').delete().eq('consultora_id', cAId);
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

function signOut(): void {
  cookieStore.length = 0;
}

describe('createSubscriptionAction', () => {
  it('1. sin auth → UNAUTHENTICATED', async () => {
    signOut();
    const { createSubscriptionAction } = await import('@/app/(app)/settings/billing/actions');
    const result = await createSubscriptionAction();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHENTICATED');
    expect(createPreapprovalMock).not.toHaveBeenCalled();
  });

  it('2. member non-owner → FORBIDDEN_NOT_OWNER', async () => {
    await signInAs(emailMemberA);
    const { createSubscriptionAction } = await import('@/app/(app)/settings/billing/actions');
    const result = await createSubscriptionAction();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FORBIDDEN_NOT_OWNER');
    expect(createPreapprovalMock).not.toHaveBeenCalled();
  });

  it('3. owner happy → ok + initPoint + fila pendiente_autorizacion', async () => {
    const mpId = `mp-pre-${runId}-3`;
    const initPoint = `https://www.mercadopago.com.ar/preapproval?preapproval_id=${mpId}`;
    createPreapprovalMock.mockResolvedValueOnce({
      id: mpId,
      init_point: initPoint,
      status: 'pending',
    });

    await signInAs(emailOwnerA);
    const { createSubscriptionAction } = await import('@/app/(app)/settings/billing/actions');
    const result = await createSubscriptionAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.initPoint).toBe(initPoint);
    expect(result.mpSubscriptionId).toBe(mpId);

    expect(createPreapprovalMock).toHaveBeenCalledOnce();
    const callArg = createPreapprovalMock.mock.calls[0]![0];
    expect(callArg.payerEmail).toBe(emailOwnerA);
    // ARS_PRICE_MONTHLY="3000000" centavos → 30000 pesos.
    expect(callArg.transactionAmountPesos).toBe(30000);
    expect(callArg.reason).toContain('Pro');
    expect(callArg.backUrl).toContain('/settings/billing');

    const { data: sub } = await admin
      .from('suscripciones')
      .select('estado, mp_subscription_id, plan_codigo, consultora_id')
      .eq('consultora_id', cAId)
      .single();
    expect(sub?.estado).toBe('pendiente_autorizacion');
    expect(sub?.mp_subscription_id).toBe(mpId);
    expect(sub?.plan_codigo).toBe('pro_mensual');
  });

  it('4. con suscripcion activa existente → DUPLICATE_SUBSCRIPTION', async () => {
    await admin.from('suscripciones').insert({
      consultora_id: cAId,
      plan_codigo: 'pro_mensual',
      estado: 'activa',
      mp_subscription_id: `mp-pre-${runId}-existing`,
      periodo_inicio: new Date().toISOString(),
      periodo_fin: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });

    await signInAs(emailOwnerA);
    const { createSubscriptionAction } = await import('@/app/(app)/settings/billing/actions');
    const result = await createSubscriptionAction();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DUPLICATE_SUBSCRIPTION');
    expect(createPreapprovalMock).not.toHaveBeenCalled();
  });

  it('5. MP API error → MP_API_ERROR', async () => {
    const { MercadoPagoError } = await import('@/shared/mercadopago/client');
    createPreapprovalMock.mockRejectedValueOnce(
      new MercadoPagoError('MP timeout', 504, { error: 'gateway_timeout' }),
    );

    await signInAs(emailOwnerA);
    const { createSubscriptionAction } = await import('@/app/(app)/settings/billing/actions');
    const result = await createSubscriptionAction();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MP_API_ERROR');

    const { data: subs } = await admin.from('suscripciones').select('id').eq('consultora_id', cAId);
    expect(subs ?? []).toHaveLength(0);
  });
});

describe('cancelSubscriptionAction', () => {
  it('6. sin auth → UNAUTHENTICATED', async () => {
    signOut();
    const { cancelSubscriptionAction } = await import('@/app/(app)/settings/billing/actions');
    const result = await cancelSubscriptionAction('00000000-0000-0000-0000-000000000000');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('7. id no-uuid → INVALID_INPUT', async () => {
    await signInAs(emailOwnerA);
    const { cancelSubscriptionAction } = await import('@/app/(app)/settings/billing/actions');
    const result = await cancelSubscriptionAction('not-a-uuid');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
  });

  it('8. id de otra consultora → NOT_FOUND (RLS filtra)', async () => {
    await signInAs(emailOwnerA);
    const { cancelSubscriptionAction } = await import('@/app/(app)/settings/billing/actions');
    const result = await cancelSubscriptionAction(subBId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
    expect(cancelPreapprovalMock).not.toHaveBeenCalled();
  });

  it('9. owner happy → MP cancel called + cancelar_en set', async () => {
    const mpId = `mp-pre-${runId}-9`;
    const { data: sub } = await admin
      .from('suscripciones')
      .insert({
        consultora_id: cAId,
        plan_codigo: 'pro_mensual',
        estado: 'activa',
        mp_subscription_id: mpId,
        periodo_inicio: new Date().toISOString(),
        periodo_fin: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      })
      .select('id')
      .single();
    cancelPreapprovalMock.mockResolvedValueOnce(undefined);

    await signInAs(emailOwnerA);
    const { cancelSubscriptionAction } = await import('@/app/(app)/settings/billing/actions');
    const result = await cancelSubscriptionAction(sub!.id);
    expect(result.ok).toBe(true);
    expect(cancelPreapprovalMock).toHaveBeenCalledWith(mpId);

    const { data: subAfter } = await admin
      .from('suscripciones')
      .select('cancelar_en, cancelada_en, estado')
      .eq('id', sub!.id)
      .single();
    expect(subAfter?.cancelar_en).not.toBeNull();
    // cancelada_en + estado=cancelada los setea el webhook, no la action.
    expect(subAfter?.cancelada_en).toBeNull();
    expect(subAfter?.estado).toBe('activa');
  });

  it('10. sub sin mp_subscription_id → NOT_CANCELABLE', async () => {
    const { data: sub } = await admin
      .from('suscripciones')
      .insert({
        consultora_id: cAId,
        plan_codigo: 'pro_mensual',
        estado: 'trial',
        periodo_inicio: new Date().toISOString(),
        periodo_fin: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      })
      .select('id')
      .single();

    await signInAs(emailOwnerA);
    const { cancelSubscriptionAction } = await import('@/app/(app)/settings/billing/actions');
    const result = await cancelSubscriptionAction(sub!.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_CANCELABLE');
    expect(cancelPreapprovalMock).not.toHaveBeenCalled();
  });
});
