/**
 * T-142 · FU1 · Integration tests del marcado real de onboarding.
 *
 * El onboarding ya NO se marca al clickear el wizard, sino cuando el tenant hace
 * una acción real. Cubre:
 *   1. Helper `markOnboardingCompletedIfPending`: setea cuando la columna está NULL.
 *   2. Helper idempotente: NO pisa un timestamp existente (red→green: sacar el
 *      `.is('onboarding_completado_at', null)` del helper → este caso falla).
 *   3. End-to-end vía `createInformeAction`: crear el primer informe marca la
 *      columna; un segundo informe NO cambia el timestamp (idempotencia real).
 *
 * Mocks idénticos a informes-actions.test.ts (server-only no-op + next/headers
 * cookies + next/cache stub). El helper usa `createServiceRoleClient()` real.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
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
const slug = `t142fu1-${runId}`;
const email = `t142fu1-${runId}@example.com`;
const password = 'TestPassword123!';

let cId: string;
let userId: string;

async function readOnboardingAt(): Promise<string | null> {
  const { data } = await admin
    .from('consultoras')
    .select('onboarding_completado_at')
    .eq('id', cId)
    .single();
  return data?.onboarding_completado_at ?? null;
}

beforeAll(async () => {
  const c = await createTestConsultora(admin, { name: 'T142-FU1', slug });
  cId = c.id;

  const { data: u, error: errU } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (errU) throw errU;
  userId = u.user.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: userId, consultora_id: cId, role: 'owner' });
  await admin.auth.admin.updateUserById(userId, { app_metadata: { consultora_id: cId } });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userId).catch(() => {});
});

beforeEach(async () => {
  cookieStore.length = 0;
  // Cada test arranca con el onboarding pendiente.
  await admin.from('consultoras').update({ onboarding_completado_at: null }).eq('id', cId);
});

describe('markOnboardingCompletedIfPending', () => {
  it('1. setea la columna cuando está NULL', async () => {
    expect(await readOnboardingAt()).toBeNull();

    const { markOnboardingCompletedIfPending } =
      await import('@/app/(app)/onboarding/mark-completed');
    await markOnboardingCompletedIfPending(cId);

    expect(await readOnboardingAt()).not.toBeNull();
  });

  it('2. NO pisa un timestamp existente (idempotente)', async () => {
    const past = '2020-01-01T00:00:00.000Z';
    await admin.from('consultoras').update({ onboarding_completado_at: past }).eq('id', cId);

    const { markOnboardingCompletedIfPending } =
      await import('@/app/(app)/onboarding/mark-completed');
    await markOnboardingCompletedIfPending(cId);

    const after = await readOnboardingAt();
    expect(after).not.toBeNull();
    // Comparar por instante: Postgres devuelve +00:00 con ms, no Z literal.
    expect(new Date(after as string).toISOString()).toBe(new Date(past).toISOString());
  });
});

describe('createInformeAction → marca onboarding real', () => {
  async function signInOwner(): Promise<void> {
    cookieStore.length = 0;
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
  }

  it('3. el primer informe marca la columna; el segundo no cambia el timestamp', async () => {
    expect(await readOnboardingAt()).toBeNull();
    await signInOwner();

    const { createInformeAction } = await import('@/app/(app)/informes/actions');

    const first = await createInformeAction({ tipo: 'rgrl', titulo: 'Primer informe del tenant' });
    expect(first.ok).toBe(true);

    const afterFirst = await readOnboardingAt();
    expect(afterFirst).not.toBeNull();

    const second = await createInformeAction({
      tipo: 'rgrl',
      titulo: 'Segundo informe del tenant',
    });
    expect(second.ok).toBe(true);

    const afterSecond = await readOnboardingAt();
    expect(new Date(afterSecond as string).toISOString()).toBe(
      new Date(afterFirst as string).toISOString(),
    );
  });
});
