/**
 * T-036 · Tests integration de `updateAutoCreateEventToggleAction`.
 *
 * Cubre:
 *  1. Owner toggle ON -> ok + persiste en DB.
 *  2. Member non-owner -> FORBIDDEN (gate explicito en la action).
 *  3. Idempotencia: toggle al mismo valor -> ok sin error.
 *  4. UNAUTHENTICATED sin sesion.
 *  5. INVALID_INPUT con valor no-boolean.
 *
 * Mocks identicos a informes-publish-action.test.ts: server-only no-op +
 * next/headers.cookies con store mutable + next/cache.revalidatePath stub.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
const slug = `t036-workflow-${runId}`;
const ownerEmail = `t036-workflow-owner-${runId}@example.com`;
const memberEmail = `t036-workflow-member-${runId}@example.com`;
const password = 'TestPassword123!';

let consultoraId: string;
let ownerId: string;
let memberId: string;

async function signinAs(email: string) {
  cookieStore.length = 0;
  const { createClient } = await import('@/shared/supabase/server');
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T036 Workflow Consultora', slug })
    .select('id')
    .single();
  consultoraId = c!.id;

  const ownerRes = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
  });
  ownerId = ownerRes.data.user!.id;
  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: consultoraId, role: 'owner' });
  await admin.auth.admin.updateUserById(ownerId, {
    app_metadata: { consultora_id: consultoraId },
  });

  const memberRes = await admin.auth.admin.createUser({
    email: memberEmail,
    password,
    email_confirm: true,
  });
  memberId = memberRes.data.user!.id;
  await admin
    .from('consultora_members')
    .insert({ user_id: memberId, consultora_id: consultoraId, role: 'member' });
  await admin.auth.admin.updateUserById(memberId, {
    app_metadata: { consultora_id: consultoraId },
  });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(ownerId).catch(() => {});
  await admin.auth.admin.deleteUser(memberId).catch(() => {});
  try {
    await admin.from('consultoras').delete().eq('id', consultoraId);
  } catch {
    // ignore
  }
});

describe('updateAutoCreateEventToggleAction', () => {
  it('1. owner enabled=true -> ok + DB actualiza', async () => {
    await signinAs(ownerEmail);
    const { updateAutoCreateEventToggleAction } =
      await import('@/app/(app)/settings/consultora/actions');

    const result = await updateAutoCreateEventToggleAction(true);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.enabled).toBe(true);

    const { data } = await admin
      .from('consultoras')
      .select('auto_create_event_on_sign')
      .eq('id', consultoraId)
      .single();
    expect(data?.auto_create_event_on_sign).toBe(true);
  });

  it('2. owner enabled=false -> ok + DB actualiza (transicion ON -> OFF)', async () => {
    // El test 1 ya dejo el flag en true. Ahora ponemos en false.
    await signinAs(ownerEmail);
    const { updateAutoCreateEventToggleAction } =
      await import('@/app/(app)/settings/consultora/actions');

    const result = await updateAutoCreateEventToggleAction(false);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.enabled).toBe(false);

    const { data } = await admin
      .from('consultoras')
      .select('auto_create_event_on_sign')
      .eq('id', consultoraId)
      .single();
    expect(data?.auto_create_event_on_sign).toBe(false);
  });

  it('3. member non-owner -> FORBIDDEN + DB no cambia', async () => {
    // Setup: dejar flag en false. Member intenta ponerlo en true.
    await admin
      .from('consultoras')
      .update({ auto_create_event_on_sign: false })
      .eq('id', consultoraId);

    await signinAs(memberEmail);
    const { updateAutoCreateEventToggleAction } =
      await import('@/app/(app)/settings/consultora/actions');

    const result = await updateAutoCreateEventToggleAction(true);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('FORBIDDEN');

    const { data } = await admin
      .from('consultoras')
      .select('auto_create_event_on_sign')
      .eq('id', consultoraId)
      .single();
    expect(data?.auto_create_event_on_sign).toBe(false);
  });

  it('4. idempotency: toggle al mismo valor -> ok sin error', async () => {
    // Setup: flag en true. Owner lo vuelve a setear a true.
    await admin
      .from('consultoras')
      .update({ auto_create_event_on_sign: true })
      .eq('id', consultoraId);

    await signinAs(ownerEmail);
    const { updateAutoCreateEventToggleAction } =
      await import('@/app/(app)/settings/consultora/actions');

    const result = await updateAutoCreateEventToggleAction(true);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.enabled).toBe(true);

    const { data } = await admin
      .from('consultoras')
      .select('auto_create_event_on_sign')
      .eq('id', consultoraId)
      .single();
    expect(data?.auto_create_event_on_sign).toBe(true);
  });

  it('5. UNAUTHENTICATED sin sesion', async () => {
    cookieStore.length = 0;
    const { updateAutoCreateEventToggleAction } =
      await import('@/app/(app)/settings/consultora/actions');
    const result = await updateAutoCreateEventToggleAction(true);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('6. INVALID_INPUT con valor no-boolean', async () => {
    await signinAs(ownerEmail);
    const { updateAutoCreateEventToggleAction } =
      await import('@/app/(app)/settings/consultora/actions');
    // @ts-expect-error cast intencional: el TS de la signature rechaza no-boolean,
    // pero la action corre runtime contra inputs arbitrarios.
    const result = await updateAutoCreateEventToggleAction('yes');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_INPUT');
  });
});
