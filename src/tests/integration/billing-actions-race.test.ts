/**
 * CHORE-D · I1 · Integration test del race condition en createSubscriptionAction.
 *
 * Cobertura:
 *  1. 2 calls Promise.all simultáneas (mismo user, misma consultora):
 *     - Solo 1 INSERT exitoso en `suscripciones` (UNIQUE PARTIAL bloquea al loser).
 *     - El loser cancela su preapproval huérfano en MP (best-effort cleanup).
 *     - Ambos clients reciben el MISMO initPoint (el del winner).
 *     - createPreapprovalMock llamado 2× (la cancel del loser fue post-INSERT,
 *       no podíamos saber pre-INSERT cuál ganaba el race).
 *
 * Setup minimal — sub única por test (limpieza en beforeEach).
 * Mocks idénticos a billing-actions.test.ts para no divergir patrones.
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

const slugA = `cdi1-${runId}`;
const emailOwnerA = `cdi1-own-${runId}@example.com`;

let cAId: string;
let ownerAId: string;

beforeAll(async () => {
  // Setup SECUENCIAL — lesson T-047 (Promise.all flaky sa-east-1) aplica
  // al auth admin API, NO al INSERT del race test (eso es justamente lo que
  // queremos disparar concurrente).
  const { data: cA, error: errCA } = await admin
    .from('consultoras')
    .insert({ name: 'CDI1', slug: slugA })
    .select('id')
    .single();
  if (errCA) throw errCA;
  cAId = cA.id;

  const { data: uOA, error: errUOA } = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  if (errUOA) throw errUOA;
  ownerAId = uOA.user.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: ownerAId, consultora_id: cAId, role: 'owner' });

  await admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } });
});

afterAll(async () => {
  await admin.from('facturas').delete().eq('consultora_id', cAId);
  await admin.from('suscripciones').delete().eq('consultora_id', cAId);
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  // PostgrestFilterBuilder es thenable pero no nativo Promise — sin try/catch
  // un FK violation o transient error tira el afterAll. Wrappeamos.
  try {
    await admin.from('consultoras').delete().eq('id', cAId);
  } catch {
    // Limpieza best-effort.
  }
});

beforeEach(async () => {
  cookieStore.length = 0;
  createPreapprovalMock.mockReset();
  cancelPreapprovalMock.mockReset();
  loggerWarnMock.mockClear();
  loggerErrorMock.mockClear();
  loggerInfoMock.mockClear();
  await admin.from('facturas').delete().eq('consultora_id', cAId);
  await admin.from('suscripciones').delete().eq('consultora_id', cAId);
});

async function signInAs(email: string): Promise<void> {
  cookieStore.length = 0;
  const { createClient: createServerClient } = await import('@/shared/supabase/server');
  const sb = await createServerClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
}

describe('CHORE-D · I1 · createSubscriptionAction race condition', () => {
  it('2 calls Promise.all concurrent → 1 INSERT, 1 cancel MP, mismo initPoint', async () => {
    // Cada call al mock createPreapproval devuelve IDs distintos para que
    // podamos verificar que el cancelPreapprovalMock recibe el ID del loser
    // (no del winner). El orden de resolución en MP es lo que define el winner.
    let preapprovalCallCount = 0;
    createPreapprovalMock.mockImplementation(() => {
      const n = ++preapprovalCallCount;
      return Promise.resolve({
        id: `mp_preapproval_race_${runId}_${n}`,
        init_point: `https://mp.test/checkout/race_${n}`,
        status: 'pending',
      });
    });
    cancelPreapprovalMock.mockResolvedValue(undefined);

    await signInAs(emailOwnerA);

    const { createSubscriptionAction } = await import('@/app/(app)/settings/billing/actions');

    const [res1, res2] = await Promise.all([
      createSubscriptionAction(),
      createSubscriptionAction(),
    ]);

    const okResults = [res1, res2].filter((r) => r.ok === true);
    const dupResults = [res1, res2].filter(
      (r) => r.ok === false && r.code === 'DUPLICATE_SUBSCRIPTION_PENDING',
    );

    expect(okResults).toHaveLength(1);
    expect(dupResults).toHaveLength(1);

    const okRes = okResults[0] as Extract<typeof res1, { ok: true }>;
    const dupRes = dupResults[0] as Extract<
      typeof res1,
      { code: 'DUPLICATE_SUBSCRIPTION_PENDING' }
    >;

    // El dup devuelve el initPoint del winner (mismo string).
    expect(dupRes.initPoint).toBe(okRes.initPoint);

    // MP createPreapproval llamado 2× (uno por call — la cancel ocurre POST-INSERT).
    expect(createPreapprovalMock).toHaveBeenCalledTimes(2);

    // MP cancelPreapproval llamado 1× — el loser limpia su huérfano.
    // El argumento debe ser el mpSubscriptionId del LOSER (no el del winner).
    expect(cancelPreapprovalMock).toHaveBeenCalledTimes(1);
    const cancelledId = cancelPreapprovalMock.mock.calls[0]?.[0] as string;
    expect(cancelledId).not.toBe(okRes.mpSubscriptionId);
    expect(cancelledId).toMatch(/^mp_preapproval_race_/);

    // DB: solo 1 fila en suscripciones para consultoraA en estado pendiente.
    const { data: subs, error: subsErr } = await admin
      .from('suscripciones')
      .select('id, mp_subscription_id, estado, init_point')
      .eq('consultora_id', cAId);
    expect(subsErr).toBeNull();
    expect(subs).toHaveLength(1);
    const onlySub = subs?.[0];
    expect(onlySub).toBeDefined();
    expect(onlySub?.estado).toBe('pendiente_autorizacion');
    expect(onlySub?.mp_subscription_id).toBe(okRes.mpSubscriptionId);
    expect(onlySub?.init_point).toBe(okRes.initPoint);

    // Log explícito del race detected.
    expect(
      loggerInfoMock.mock.calls.some(
        ([, msg]) =>
          typeof msg === 'string' &&
          msg.includes('I1 race detected, devolviendo initPoint del ganador'),
      ),
    ).toBe(true);
  });
});
