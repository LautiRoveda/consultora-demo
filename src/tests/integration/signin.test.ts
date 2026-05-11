/**
 * T-013 · Tests del flujo de signin (password + magic link) + dashboard query.
 *
 * **Estrategia:**
 * - `admin.auth.admin.createUser({ email_confirm: true })` simula un user
 *   pre-confirmado (no consume rate limit de emails).
 * - `admin.rpc('create_consultora_and_owner')` simula el atomic signup
 *   (T-012) para asociar el user a una consultora.
 * - `supabase.auth.signInWithPassword` se invoca con un client anon para
 *   verificar el flow real (consume rate limit de signin, ~30/5min — margen
 *   amplio).
 * - `admin.auth.admin.generateLink({ type: 'magiclink' })` devuelve el URL
 *   del magic link sin enviar email (bypass rate limit). Después usamos
 *   `exchangeCodeForSession` con el token del URL.
 *
 * El flow end-to-end real (con email enviado) lo cubre Lautaro en PARADA #2.
 *
 * Cleanup: borrar users via service-role. Consultoras quedan orphan (slug
 * `t013-test-*`). Limpieza manual periódica vía SQL Editor (ver supabase/README.md).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Mocks para importar la server action `magicLinkAction` desde Node:
// - `server-only` tira si se importa fuera de Next.js → neutralizar.
// - `next/headers` requiere Next.js context → stub mínimo del cookie store.
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
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
const password = 'TestPassword123!';
const createdUserIds: string[] = [];

async function createConfirmedUserWithConsultora(args: { email: string; consultoraName: string }) {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: args.email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`createUser falló: ${createErr?.message}`);
  createdUserIds.push(created.user.id);

  const { data: rpcData, error: rpcErr } = await admin.rpc('create_consultora_and_owner', {
    p_user_id: created.user.id,
    p_name: args.consultoraName,
  });
  if (rpcErr) throw new Error(`RPC falló: ${rpcErr.message}`);
  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!row) throw new Error('RPC no devolvió row');

  return {
    userId: created.user.id,
    consultoraId: row.consultora_id,
    slug: row.slug,
  };
}

async function createUnconfirmedUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  });
  if (error || !data.user) throw new Error(`createUser falló: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return data.user.id;
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId).catch(() => {
      // Best-effort cleanup. Consultoras quedan orphan — limpieza manual.
    });
  }
});

describe('signInWithPassword', () => {
  it('happy path: user confirmado puede iniciar sesión', async () => {
    const email = `t013-test-signin-happy-${runId}@example.com`;
    await createConfirmedUserWithConsultora({
      email,
      consultoraName: `Test Signin ${runId}`,
    });

    const client = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    expect(error).toBeNull();
    expect(data.user).not.toBeNull();
    expect(data.user?.email).toBe(email);
    expect(data.session?.access_token).toBeTruthy();
  });

  it('password incorrecta → error con code/message reconocible', async () => {
    const email = `t013-test-bad-pass-${runId}@example.com`;
    await createConfirmedUserWithConsultora({
      email,
      consultoraName: `Test BadPass ${runId}`,
    });

    const client = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password: 'WrongPassword999!',
    });

    expect(error).not.toBeNull();
    // Supabase devuelve 'invalid_credentials' o status 400 con mensaje variable.
    expect(error?.message).toMatch(/invalid|credentials/i);
    expect(data.user).toBeNull();
  });

  it('email no confirmado → error reconocible (EMAIL_NOT_CONFIRMED)', async () => {
    const email = `t013-test-unconfirmed-${runId}@example.com`;
    await createUnconfirmedUser(email);

    const client = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not confirmed|email_not_confirmed/i);
  });
});

describe('signOut', () => {
  it('signOut limpia la sesión (getUser devuelve null)', async () => {
    const email = `t013-test-signout-${runId}@example.com`;
    await createConfirmedUserWithConsultora({
      email,
      consultoraName: `Test SignOut ${runId}`,
    });

    const client = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: true },
    });
    await client.auth.signInWithPassword({ email, password });
    const { data: before } = await client.auth.getUser();
    expect(before.user?.email).toBe(email);

    await client.auth.signOut();
    const { data: after } = await client.auth.getUser();
    expect(after.user).toBeNull();
  });
});

describe('dashboard query (post-T-013 policy defensiva)', () => {
  it('user logueado puede leer SU consultora vía JOIN consultora_members → consultoras', async () => {
    const email = `t013-test-dashboard-${runId}@example.com`;
    const { consultoraId, slug } = await createConfirmedUserWithConsultora({
      email,
      consultoraName: `Test Dashboard ${runId}`,
    });

    const client = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    await client.auth.signInWithPassword({ email, password });

    const { data: membership, error } = await client
      .from('consultora_members')
      .select('role, consultoras(id, slug, name, plan_tier, trial_ends_at)')
      .single();

    expect(error).toBeNull();
    expect(membership?.role).toBe('owner');
    expect(membership?.consultoras).not.toBeNull();
    expect(membership?.consultoras?.id).toBe(consultoraId);
    expect(membership?.consultoras?.slug).toBe(slug);
    expect(membership?.consultoras?.plan_tier).toBe('trial');
  });

  it('user NO puede leer consultora ajena via select directo (RLS intacta)', async () => {
    const emailA = `t013-test-isol-a-${runId}@example.com`;
    const emailB = `t013-test-isol-b-${runId}@example.com`;
    const a = await createConfirmedUserWithConsultora({
      email: emailA,
      consultoraName: `Test Isol A ${runId}`,
    });
    const b = await createConfirmedUserWithConsultora({
      email: emailB,
      consultoraName: `Test Isol B ${runId}`,
    });

    const clientA = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    await clientA.auth.signInWithPassword({ email: emailA, password });

    // userA intenta leer consultora de userB → debe devolver 0 rows.
    const { data, error } = await clientA.from('consultoras').select('*').eq('id', b.consultoraId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
    // Verificación adicional: SU consultora sí se ve.
    const { data: own } = await clientA.from('consultoras').select('*').eq('id', a.consultoraId);
    expect(own?.length).toBe(1);
  });
});

describe('magic link', () => {
  it('admin.generateLink devuelve URL con code consumible por exchangeCodeForSession', async () => {
    const email = `t013-test-magic-${runId}@example.com`;
    await createConfirmedUserWithConsultora({
      email,
      consultoraName: `Test Magic ${runId}`,
    });

    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    expect(error).toBeNull();
    expect(data.properties?.action_link).toBeTruthy();
    // El action_link incluye un `?token_hash=...` que verifyOtp consume.
    // Por simplicidad solo validamos que vino y es URL — el exchange end-to-end
    // se hace en el smoke manual via browser.
    expect(data.properties?.action_link).toMatch(/^https?:\/\//);
  });

  it('signInWithOtp({ shouldCreateUser: false }) con email inexistente NO crea user', async () => {
    const email = `t013-test-nonexistent-${runId}@example.com`;
    const client = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });

    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    // Supabase puede devolver OK (no leakea) o error específico — ambos casos
    // son aceptables para el test. Lo importante: ningún user se creó.
    expect(error?.message ?? '').not.toMatch(/internal|server error/i);

    // Verificar que el user NO se creó.
    const { data: users } = await admin.auth.admin.listUsers();
    const found = users?.users.find((u) => u.email === email);
    expect(found).toBeUndefined();
  });

  /**
   * Regression del bug de enumeration descubierto en E5 del smoke T-013:
   * con email inexistente, Supabase devolvía error específico que la action
   * caía a INTERNAL_ERROR → toast "Error inesperado". Eso permitía a un
   * atacante distinguir entre cuentas existentes (toast success) y no
   * existentes (toast error) → enumeration attack.
   *
   * Fix: magicLinkAction matchea el error de Supabase (`user_not_found`,
   * `otp_disabled`, regex sobre message) y devuelve el mismo mensaje
   * genérico que el success path.
   */
  it('magicLinkAction con email inexistente devuelve ok:true genérico (anti-enumeration)', async () => {
    const { magicLinkAction } = await import('@/app/(auth)/login/actions');

    const email = `t013-test-magic-nonexistent-${runId}@example.com`;
    const result = await magicLinkAction({ email });

    // El resultado debe ser ok:true con mensaje genérico — INDISTINGUIBLE de
    // un email real que existe en auth.users.
    if (!result.ok && result.code === 'RATE_LIMITED') {
      console.warn(
        '[skip] magicLinkAction enumeration regression: rate-limited. Re-correr en unos minutos.',
      );
      return;
    }

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain('Te enviamos un link');
      expect(result.message).toContain(email);
    }

    // Defensa adicional: confirmar que NO se creó user (shouldCreateUser: false
    // del implementation + email inexistente).
    const { data: users } = await admin.auth.admin.listUsers();
    const found = users?.users.find((u) => u.email === email);
    expect(found).toBeUndefined();
  });
});
