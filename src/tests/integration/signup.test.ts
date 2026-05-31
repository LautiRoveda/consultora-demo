/**
 * T-012 · Tests del RPC create_consultora_and_owner.
 *
 * **No invoca `supabase.auth.signUp` directamente** porque Supabase impone
 * rate limit de ~30 signUps/h por IP, lo que rompe iteración rápida en local.
 *
 * En su lugar: `admin.auth.admin.createUser` (sin rate limit) simula el row
 * en auth.users que signUp habría creado, después invocamos el RPC. Cubre el
 * 80% del valor: la lógica que escribimos en T-012 (slug normalization, retry
 * por colisión, trial 7d, owner role) es del RPC, NO del signUp.
 *
 * El flujo end-to-end con `supabase.auth.signUp` se verifica:
 * - Manualmente en PARADA #2 (Lautaro con email real desde localhost:3000).
 * - Post-merge contra production.
 *
 * Cleanup: borrar users via service-role. Consultoras quedan orphan (slug
 * `t012-test-*`). Limpieza manual periódica en supabase/README.md.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Mocks para poder importar la server action `signupAction` desde un test Node:
// - `server-only` tira si se importa fuera de Next.js — neutralizar.
// - `next/headers` no existe sin Next.js context — stub mínimo del cookie store
//   (signupAction llama setAll en signUp; con setters no-op pasa sin error).
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
      set: () => {},
    }),
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
const createdUserIds: string[] = [];

/**
 * Helper: crea un auth.users row vía admin (sin email send) y devuelve el id.
 * Simula el row que `supabase.auth.signUp` habría creado en producción.
 */
async function createAuthUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'TestPassword123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser falló: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return data.user.id;
}

/**
 * Helper: invoca el RPC y devuelve consultora_id + slug (o tira si falla).
 */
async function callRpc(p_user_id: string, p_name: string) {
  const { data, error } = await admin.rpc('create_consultora_and_owner', {
    p_user_id,
    p_name,
  });
  if (error) throw new Error(`RPC falló: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('RPC no devolvió row');
  return { consultoraId: row.consultora_id, slug: row.slug };
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId).catch(() => {
      // Best-effort cleanup. Si falla, queda orphan — log + limpieza manual.
    });
  }
});

describe('RPC create_consultora_and_owner: happy path', () => {
  it('crea consultora con plan=trial + trial_hasta ~14d', async () => {
    const userId = await createAuthUser(`t012-test-trial-${runId}@example.com`);
    const { consultoraId, slug } = await callRpc(userId, `Test Trial ${runId}`);

    const { data: consultora } = await admin
      .from('consultoras')
      .select('*')
      .eq('id', consultoraId)
      .single();

    expect(consultora).not.toBeNull();
    expect(consultora?.plan).toBe('trial');
    expect(consultora?.name).toBe(`Test Trial ${runId}`);
    expect(consultora?.slug).toBe(slug);

    // T-108: trial_hasta ~ now + 14d (toleramos ±5 min por latencia red/clock skew).
    const trialEnd = new Date(consultora!.trial_hasta!).getTime();
    const expected = Date.now() + 14 * 24 * 60 * 60 * 1000;
    expect(Math.abs(trialEnd - expected)).toBeLessThan(5 * 60 * 1000);
  });

  it('crea membership con role=owner', async () => {
    const userId = await createAuthUser(`t012-test-owner-${runId}@example.com`);
    const { consultoraId } = await callRpc(userId, `Test Owner ${runId}`);

    const { data: member } = await admin
      .from('consultora_members')
      .select('*')
      .eq('user_id', userId)
      .eq('consultora_id', consultoraId)
      .single();

    expect(member?.role).toBe('owner');
  });
});

describe('RPC create_consultora_and_owner: slug normalization', () => {
  it('lower + unaccent + reemplazo de no-alfanum: "Consultoría Pérez & Asociados"', async () => {
    const userId = await createAuthUser(`t012-test-slug-acc-${runId}@example.com`);
    const { slug } = await callRpc(userId, 'Consultoría Pérez & Asociados');
    expect(slug).toMatch(/^consultoria-perez-asociados-[a-f0-9]{4}$/);
  });

  it('fallback "consultora-XXXX" cuando el nombre es solo caracteres especiales', async () => {
    const userId = await createAuthUser(`t012-test-slug-fb-${runId}@example.com`);
    const { slug } = await callRpc(userId, '!!!');
    expect(slug).toMatch(/^consultora-[a-f0-9]{4}$/);
  });

  it('dos consultoras con el mismo nombre obtienen sufijos distintos', async () => {
    const userIdA = await createAuthUser(`t012-test-coll-a-${runId}@example.com`);
    const userIdB = await createAuthUser(`t012-test-coll-b-${runId}@example.com`);
    const name = `Idem Nombre ${runId}`;
    const a = await callRpc(userIdA, name);
    const b = await callRpc(userIdB, name);
    expect(a.slug).not.toBe(b.slug);
    const baseA = a.slug.replace(/-[a-f0-9]{4}$/, '');
    const baseB = b.slug.replace(/-[a-f0-9]{4}$/, '');
    expect(baseA).toBe(baseB);
  });

  it('nombre largo: trunca base a 55 chars antes del sufijo', async () => {
    const userId = await createAuthUser(`t012-test-long-${runId}@example.com`);
    const longName = 'A'.repeat(80);
    const { slug } = await callRpc(userId, longName);
    // base (55 'a's) + '-' + 4 hex = 60 chars max.
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).toMatch(/^a{55}-[a-f0-9]{4}$/);
  });
});

describe('RPC create_consultora_and_owner: security', () => {
  it('anon NO puede invocar el RPC (sin grant execute)', async () => {
    const anonClient = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    const { error } = await anonClient.rpc('create_consultora_and_owner', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_name: 'Attack',
    });
    expect(error).not.toBeNull();
    // Postgres devuelve "permission denied for function create_consultora_and_owner"
    // o similar. Lo importante es que la llamada falla.
  });

  it('RLS bloquea INSERT directo en consultoras desde anon (sin pasar por el RPC)', async () => {
    const anonClient = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    const { error } = await anonClient
      .from('consultoras')
      .insert({ name: 'Bypass attempt', slug: `bypass-${runId}` });
    expect(error).not.toBeNull();
  });
});

/**
 * Regression test del bug T-012 descubierto durante smoke manual de T-013:
 * el RPC `create_consultora_and_owner` fallaba con `permission denied`
 * (Postgres 42501) cuando `signupAction` lo invocaba via cookie-based server
 * client — la sesión de signUp() no se propaga en cookies dentro de la misma
 * request, así que el RPC corre con role 'anon' efectivo (que está revokeado).
 *
 * Fix: signupAction ahora invoca la RPC via service-role client.
 *
 * Este test ejecuta el flow REAL (`supabase.auth.signUp` + RPC vía service-role
 * dentro de signupAction). Consume 1 email send por run (rate limit Supabase
 * ~30/h). Acceptable para una suite local pre-PR.
 */
describe('signupAction (regression bug T-012/T-013)', () => {
  it('signupAction completo crea user en auth.users + consultora + membership owner', async () => {
    const { signupAction } = await import('@/app/(auth)/signup/actions');

    const email = `t012-fix-${runId}@example.com`;
    const result = await signupAction({
      email,
      password: 'TestPassword123!',
      consultoraName: `Test Fix ${runId}`,
    });

    // Rate limit Supabase: signUp 429 antes de llegar a la RPC. No podemos
    // verificar el fix en este run, pero NO es regresión — passthrough con
    // warning. Cuando el rate limit se libera (~1h) el test corre el flow real.
    if (!result.ok && result.code === 'RATE_LIMITED') {
      console.warn(
        '[skip] signupAction regression: Supabase rate-limited el signUp. Re-correr en ~1h.',
      );
      return;
    }

    // Cualquier OTRO fallo (en particular `INTERNAL_ERROR`) indica regresión:
    // muy probable que el RPC haya vuelto a invocarse desde el cookie-based
    // client → permission denied → INTERNAL_ERROR. Hacer fallar el suite.
    expect(result.ok).toBe(true);
    if (!result.ok) return; // type guard

    expect(result.redirectTo).toBe(`/check-email?email=${encodeURIComponent(email)}`);

    // Verificar row en auth.users (vía admin).
    const { data: users } = await admin.auth.admin.listUsers();
    const user = users?.users.find((u) => u.email === email);
    expect(user).toBeTruthy();
    if (user) createdUserIds.push(user.id);

    // Verificar consultora + membership (vía admin, RLS bypass para verificación).
    const { data: member } = await admin
      .from('consultora_members')
      .select('role, consultoras(slug, name, plan, trial_hasta)')
      .eq('user_id', user!.id)
      .single();

    expect(member?.role).toBe('owner');
    expect(member?.consultoras?.name).toBe(`Test Fix ${runId}`);
    expect(member?.consultoras?.plan).toBe('trial');
    expect(member?.consultoras?.slug).toMatch(/^test-fix-[a-z0-9-]+-[a-f0-9]{4}$/);
  });
});
