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
import { afterAll, describe, expect, it } from 'vitest';

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
  it('crea consultora con plan_tier=trial + trial_ends_at ~7d', async () => {
    const userId = await createAuthUser(`t012-test-trial-${runId}@example.com`);
    const { consultoraId, slug } = await callRpc(userId, `Test Trial ${runId}`);

    const { data: consultora } = await admin
      .from('consultoras')
      .select('*')
      .eq('id', consultoraId)
      .single();

    expect(consultora).not.toBeNull();
    expect(consultora?.plan_tier).toBe('trial');
    expect(consultora?.name).toBe(`Test Trial ${runId}`);
    expect(consultora?.slug).toBe(slug);

    // trial_ends_at ~ now + 7d (toleramos ±5 minutos por latencia red/clock skew).
    const trialEnd = new Date(consultora!.trial_ends_at!).getTime();
    const expected = Date.now() + 7 * 24 * 60 * 60 * 1000;
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
