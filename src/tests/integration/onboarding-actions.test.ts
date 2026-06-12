/**
 * T-142 · Integration tests de completeOnboardingAction.
 *
 * Cobertura:
 *  1. owner + destination válida → ok:true + redirectTo + columna seteada.
 *  2. destination inválida → INVALID_INPUT.
 *  3. doble llamada → 2da ALREADY_DONE (idempotente, no rompe).
 *  4. sin sesión → UNAUTHORIZED.
 *  5. member non-owner → UNAUTHORIZED.
 *
 * El UPDATE usa el client autenticado del owner (RLS `consultoras_update_own_owner`),
 * no service-role. Verificamos el row con service-role.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
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

const loggerErrorMock = vi.fn();
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
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

const slug = `t142-${runId}`;
const emailOwner = `t142-own-${runId}@example.com`;
const emailMember = `t142-mem-${runId}@example.com`;

let cId: string;
let ownerId: string;
let memberId: string;

beforeAll(async () => {
  const { data: c, error: errC } = await admin
    .from('consultoras')
    .insert({ name: 'T142', slug })
    .select('id')
    .single();
  if (errC) throw errC;
  cId = c.id;

  const { data: uO, error: errUO } = await admin.auth.admin.createUser({
    email: emailOwner,
    password,
    email_confirm: true,
  });
  if (errUO) throw errUO;
  ownerId = uO.user.id;

  const { data: uM, error: errUM } = await admin.auth.admin.createUser({
    email: emailMember,
    password,
    email_confirm: true,
  });
  if (errUM) throw errUM;
  memberId = uM.user.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerId, consultora_id: cId, role: 'owner' },
    { user_id: memberId, consultora_id: cId, role: 'member' },
  ]);

  await admin.auth.admin.updateUserById(ownerId, { app_metadata: { consultora_id: cId } });
  await admin.auth.admin.updateUserById(memberId, { app_metadata: { consultora_id: cId } });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(ownerId).catch(() => {});
  await admin.auth.admin.deleteUser(memberId).catch(() => {});
  await admin.from('consultora_members').delete().eq('consultora_id', cId);
  await admin.from('consultoras').delete().eq('id', cId);
});

beforeEach(async () => {
  cookieStore.length = 0;
  loggerErrorMock.mockClear();
  // Resetear el flag para que cada test arranque con el wizard activo.
  await admin.from('consultoras').update({ onboarding_completado_at: null }).eq('id', cId);
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

describe('completeOnboardingAction', () => {
  it('1. owner + destination válida → ok + redirectTo + columna seteada', async () => {
    await signInAs(emailOwner);
    const { completeOnboardingAction } = await import('@/app/(app)/onboarding/actions');
    const result = await completeOnboardingAction({ destination: '/informes/nuevo' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirectTo).toBe('/informes/nuevo');

    const { data } = await admin
      .from('consultoras')
      .select('onboarding_completado_at')
      .eq('id', cId)
      .single();
    expect(data?.onboarding_completado_at).not.toBeNull();
  });

  it('2. destination inválida → INVALID_INPUT', async () => {
    await signInAs(emailOwner);
    const { completeOnboardingAction } = await import('@/app/(app)/onboarding/actions');
    const result = await completeOnboardingAction({ destination: '/evil/path' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
  });

  it('3. doble llamada → 2da ALREADY_DONE (idempotente)', async () => {
    await signInAs(emailOwner);
    const { completeOnboardingAction } = await import('@/app/(app)/onboarding/actions');
    const first = await completeOnboardingAction({ destination: '/epp/entregas/nueva' });
    expect(first.ok).toBe(true);

    const second = await completeOnboardingAction({ destination: '/informes/nuevo' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('ALREADY_DONE');
  });

  it('4. sin sesión → UNAUTHORIZED', async () => {
    signOut();
    const { completeOnboardingAction } = await import('@/app/(app)/onboarding/actions');
    const result = await completeOnboardingAction({ destination: '/informes/nuevo' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('5. member non-owner → UNAUTHORIZED', async () => {
    await signInAs(emailMember);
    const { completeOnboardingAction } = await import('@/app/(app)/onboarding/actions');
    const result = await completeOnboardingAction({ destination: '/informes/nuevo' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');

    // No tocó la columna.
    const { data } = await admin
      .from('consultoras')
      .select('onboarding_completado_at')
      .eq('id', cId)
      .single();
    expect(data?.onboarding_completado_at).toBeNull();
  });
});
