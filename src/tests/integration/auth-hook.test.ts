/**
 * T-016 PARADA #3 · Tests del Auth Hook custom_access_token_hook.
 *
 * Cubre 3 capas:
 * 1. Function en aislamiento (admin.rpc con event mock) — claim presente,
 *    claim ausente cuando no hay membership, defensive return con event
 *    malformado.
 * 2. Flow end-to-end real — signInWithPassword sobre user con membership
 *    inyecta el claim en el JWT post-token-issue.
 * 3. Edge case: user creado pre-T-016 (sin app_metadata seteado) recibe el
 *    claim correctamente en el primer login post-hook.
 *
 * Estrategia (consistente con rls.test.ts T-011/T-015): users + memberships
 * temporales con suffix `runId` unico por run, cleanup via admin.deleteUser.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';
const emailWithMembership = `t016-hook-with-${runId}@example.com`;
const emailNoMembership = `t016-hook-without-${runId}@example.com`;
const slug = `t016-hook-${runId}`;

let consultoraId: string;
let userWithMembershipId: string;
let userNoMembershipId: string;

interface JwtPayload {
  sub?: string;
  app_metadata?: {
    consultora_id?: string;
    consultora_role?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// Reuse del decoder de scripts/dev-smoke-jwt-claim.ts. No valida firma (server
// lo hace); solo lee el payload del segundo segmento del JWT.
function decodeJwtPayload(jwt: string): JwtPayload {
  const segments = jwt.split('.');
  if (segments.length !== 3) {
    throw new Error(`JWT mal formado: ${segments.length} segmentos`);
  }
  const b64url = segments[1]!;
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const json = Buffer.from(padded, 'base64').toString('utf-8');
  return JSON.parse(json) as JwtPayload;
}

beforeAll(async () => {
  const { data: c, error: ec } = await admin
    .from('consultoras')
    .insert({ name: 'T-016 Hook Test Consultora', slug })
    .select()
    .single();
  if (ec || !c) throw new Error(`crear consultora fallo: ${ec?.message}`);
  consultoraId = c.id;

  const [{ data: uWith, error: euWith }, { data: uNo, error: euNo }] = await Promise.all([
    admin.auth.admin.createUser({
      email: emailWithMembership,
      password,
      email_confirm: true,
    }),
    admin.auth.admin.createUser({
      email: emailNoMembership,
      password,
      email_confirm: true,
    }),
  ]);
  if (euWith || !uWith.user) throw new Error(`crear user with fallo: ${euWith?.message}`);
  if (euNo || !uNo.user) throw new Error(`crear user no fallo: ${euNo?.message}`);
  userWithMembershipId = uWith.user.id;
  userNoMembershipId = uNo.user.id;

  const { error: emErr } = await admin
    .from('consultora_members')
    .insert({ user_id: userWithMembershipId, consultora_id: consultoraId, role: 'owner' });
  if (emErr) throw new Error(`crear membership fallo: ${emErr.message}`);
});

afterAll(async () => {
  if (userWithMembershipId) await admin.auth.admin.deleteUser(userWithMembershipId);
  if (userNoMembershipId) await admin.auth.admin.deleteUser(userNoMembershipId);
});

describe('custom_access_token_hook (function aislada)', () => {
  it('user con membership → claim consultora_id + consultora_role inyectados', async () => {
    const eventMock = {
      user_id: userWithMembershipId,
      claims: {
        sub: userWithMembershipId,
        app_metadata: { provider: 'email' },
      },
    };
    const { data, error } = await admin.rpc('custom_access_token_hook', { event: eventMock });
    expect(error).toBeNull();
    const out = data as { claims?: { app_metadata?: Record<string, unknown> } };
    expect(out.claims?.app_metadata?.consultora_id).toBe(consultoraId);
    expect(out.claims?.app_metadata?.consultora_role).toBe('owner');
  });

  it('user sin membership → event devuelto sin tocar (no claim, no error)', async () => {
    const eventMock = {
      user_id: userNoMembershipId,
      claims: {
        sub: userNoMembershipId,
        app_metadata: { provider: 'email' },
      },
    };
    const { data, error } = await admin.rpc('custom_access_token_hook', { event: eventMock });
    expect(error).toBeNull();
    const out = data as { claims?: { app_metadata?: Record<string, unknown> } };
    expect(out.claims?.app_metadata?.consultora_id).toBeUndefined();
    expect(out.claims?.app_metadata?.consultora_role).toBeUndefined();
    // Provider original preservado.
    expect(out.claims?.app_metadata?.provider).toBe('email');
  });

  it('event malformado (sin user_id) → defensive return, NO throw', async () => {
    const malformed = { claims: { app_metadata: {} } };
    const { data, error } = await admin.rpc('custom_access_token_hook', { event: malformed });
    // El exception handler captura el cast `(event ->> 'user_id')::uuid` fallido
    // y devuelve el event original. NO debe propagar error al caller.
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });
});

describe('custom_access_token_hook (flow end-to-end via signInWithPassword)', () => {
  it('user con membership: JWT post-signin trae claim consultora_id + role', async () => {
    const anonClient = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: emailWithMembership,
      password,
    });
    expect(error).toBeNull();
    expect(data.session).toBeTruthy();

    const payload = decodeJwtPayload(data.session!.access_token);
    expect(payload.sub).toBe(userWithMembershipId);
    expect(payload.app_metadata?.consultora_id).toBe(consultoraId);
    expect(payload.app_metadata?.consultora_role).toBe('owner');
  });

  it('user sin membership: JWT post-signin NO trae claim consultora_id', async () => {
    const anonClient = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: emailNoMembership,
      password,
    });
    expect(error).toBeNull();
    expect(data.session).toBeTruthy();

    const payload = decodeJwtPayload(data.session!.access_token);
    expect(payload.sub).toBe(userNoMembershipId);
    expect(payload.app_metadata?.consultora_id).toBeUndefined();
    expect(payload.app_metadata?.consultora_role).toBeUndefined();
  });

  it('refresh post-signin produce JWT con claim (simula PARADA #3 login refresh)', async () => {
    const anonClient = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    await anonClient.auth.signInWithPassword({
      email: emailWithMembership,
      password,
    });
    const { data, error } = await anonClient.auth.refreshSession();
    expect(error).toBeNull();
    expect(data.session).toBeTruthy();

    const payload = decodeJwtPayload(data.session!.access_token);
    expect(payload.app_metadata?.consultora_id).toBe(consultoraId);
    expect(payload.app_metadata?.consultora_role).toBe('owner');
  });
});
