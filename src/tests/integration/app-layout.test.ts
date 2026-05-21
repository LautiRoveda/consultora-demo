/**
 * T-017 · Integration tests del layout autenticado `(app)/layout.tsx`.
 *
 * El layout combina `auth.getUser()` + `getCurrentConsultora()` + `redirect()`.
 * `redirect()` es propio de Next.js (tira NEXT_REDIRECT que sólo Next.js
 * intercepta), así que NO testeamos el redirect en sí — sí testeamos el
 * contrato que dispara los redirects:
 *
 *   1. Sin sesión → `auth.getUser()` devuelve `user: null` (el layout
 *      reacciona con `redirect('/login')`).
 *   2. Con sesión + membership → `getCurrentConsultora` devuelve la
 *      consultora con role correcto.
 *   3. Tras refresh, el JWT trae `app_metadata.consultora_id` (T-016) y el
 *      helper resuelve por fast-path con role del claim.
 *
 * Reusa el patrón de `signin.test.ts` (createUser admin + RPC signup + signin).
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';

// `getCurrentConsultora` empieza con `import 'server-only'` y depende del
// logger. Neutralizamos ambos para correr en Node.
vi.mock('server-only', () => ({}));
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

const { getCurrentConsultora } = await import('@/shared/auth/getCurrentConsultora');

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

afterAll(async () => {
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId).catch(() => {
      // Best-effort. Consultoras quedan orphan — limpieza manual periódica.
    });
  }
});

describe('(app)/layout · integration', () => {
  it('sin sesión: auth.getUser() devuelve null (caller redirect /login)', async () => {
    const client = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    const {
      data: { user },
    } = await client.auth.getUser();
    expect(user).toBeNull();
  });

  it('con sesión + membership: getCurrentConsultora devuelve consultora con role owner', async () => {
    const email = `t017-test-layout-happy-${runId}@example.com`;
    const { userId, consultoraId, slug } = await createConfirmedUserWithConsultora({
      email,
      consultoraName: `Test Layout Happy ${runId}`,
    });

    const client = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    await client.auth.signInWithPassword({ email, password });

    const result = await getCurrentConsultora(client, userId);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(consultoraId);
    expect(result?.slug).toBe(slug);
    expect(result?.role).toBe('owner');
    expect(result?.plan).toBe('trial');
    expect(result?.trialHasta).toBeTruthy();
  });

  it('fast-path por claim: el JWT trae app_metadata.consultora_id + role (T-016)', async () => {
    const email = `t017-test-claim-fastpath-${runId}@example.com`;
    const { userId, consultoraId } = await createConfirmedUserWithConsultora({
      email,
      consultoraName: `Test Claim FastPath ${runId}`,
    });

    const client = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    await client.auth.signInWithPassword({ email, password });
    // Refrescamos para garantizar JWT con custom claim (custom_access_token_hook).
    const { error: refreshErr } = await client.auth.refreshSession();
    expect(refreshErr).toBeNull();

    // Los claims del hook se inyectan al JWT (no a user.app_metadata, que es
    // la columna persistida raw_app_meta_data). Decodificamos el payload.
    const {
      data: { session },
    } = await client.auth.getSession();
    const accessToken = session?.access_token ?? '';
    const segments = accessToken.split('.');
    expect(segments.length).toBe(3);
    const b64 = (segments[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as {
      app_metadata?: { consultora_id?: string; consultora_role?: string };
    };
    expect(payload.app_metadata?.consultora_id).toBe(consultoraId);
    expect(payload.app_metadata?.consultora_role).toBe('owner');

    // Helper resuelve con esos datos del claim (fast-path: lee `consultoras`
    // directo por id; no toca `consultora_members`).
    const result = await getCurrentConsultora(client, userId);
    expect(result?.id).toBe(consultoraId);
    expect(result?.role).toBe('owner');
  });
});
