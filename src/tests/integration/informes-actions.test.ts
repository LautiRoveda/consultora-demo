/**
 * T-019 · Tests de `createInformeAction`.
 *
 * Cubre los 3 paths del discriminated union:
 *   1. INVALID_INPUT — Zod safeParse falla con tipo invalido / titulo corto.
 *   2. UNAUTHENTICATED — sin session cookie.
 *   3. ok:true — happy path con session real (createUser via admin + signIn
 *      por el server client, que popula el cookieStore mockeado).
 *
 * Mocks identicos a signup.test.ts / recovery.test.ts: `server-only` no-op
 * + `next/headers.cookies` con un store mutable a nivel modulo. signIn
 * popula el store via `setAll`; la accion lo lee via `getAll`.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

// next/cache.revalidatePath no hace nada en este runtime — stub para que la
// accion no rompa.
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
const slug = `t019-action-${runId}`;
const email = `t019-action-${runId}@example.com`;
const password = 'TestPassword123!';

let userId: string;
let consultoraId: string;

beforeAll(async () => {
  // Crear consultora + user + membership + claim consultora_id en JWT.
  const c = await createTestConsultora(admin, { name: 'T019 Action Consultora', slug });
  consultoraId = c.id;

  const { data: u } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  userId = u.user!.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: userId, consultora_id: consultoraId, role: 'owner' });

  await admin.auth.admin.updateUserById(userId, {
    app_metadata: { consultora_id: consultoraId },
  });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userId).catch(() => {});
});

describe('createInformeAction', () => {
  it('input invalido (titulo corto + tipo fuera de spec) devuelve INVALID_INPUT con fieldErrors', async () => {
    // Empezamos sin session: este test no la necesita (Zod corre antes que getUser).
    cookieStore.length = 0;
    const { createInformeAction } = await import('@/app/(app)/informes/actions');

    const result = await createInformeAction({ tipo: 'no_existe', titulo: 'ab' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_INPUT');
    if (result.code !== 'INVALID_INPUT') throw new Error('unreachable');
    expect(Object.keys(result.fieldErrors).sort()).toEqual(['tipo', 'titulo']);
    expect(result.fieldErrors.titulo?.[0]).toMatch(/3 caracteres/i);
  });

  it('sin session cookie devuelve UNAUTHENTICATED', async () => {
    cookieStore.length = 0;
    const { createInformeAction } = await import('@/app/(app)/informes/actions');

    const result = await createInformeAction({
      tipo: 'rgrl',
      titulo: 'Titulo valido sin sesion',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('happy path con session real crea informe + redirectTo + audit row', async () => {
    cookieStore.length = 0;
    // signInWithPassword via el MISMO server client cookies-mock que la accion
    // va a usar adentro. El cookieStore queda con sb-*-auth-token poblado.
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
    expect(signInErr).toBeNull();

    const { createInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await createInformeAction({
      tipo: 'rgrl',
      titulo: 'Informe creado via action',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.informeId).toBeDefined();
    expect(result.redirectTo).toBe(`/informes/${result.informeId}`);

    // Verificar persistencia + atribucion correcta (created_by = userId).
    const { data: informe } = await admin
      .from('informes')
      .select('consultora_id, created_by, titulo, tipo, status')
      .eq('id', result.informeId)
      .single();
    expect(informe?.consultora_id).toBe(consultoraId);
    expect(informe?.created_by).toBe(userId);
    expect(informe?.tipo).toBe('rgrl');
    expect(informe?.status).toBe('draft');

    // Audit trigger AFTER INSERT escribió la fila correspondiente.
    const { data: audit } = await admin
      .from('audit_log')
      .select('action, entity_type, actor_user_id')
      .eq('entity_id', result.informeId)
      .eq('action', 'created')
      .single();
    expect(audit?.entity_type).toBe('informes');
    expect(audit?.actor_user_id).toBe(userId);
  });
});
