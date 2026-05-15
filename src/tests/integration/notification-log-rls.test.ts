/**
 * T-031 · RLS + inmutabilidad de `notification_log`.
 *
 * Cobertura:
 * - SELECT cross-tenant denied (RLS via is_member_of_consultora).
 * - SELECT same-tenant permitido (cualquier member).
 * - INSERT por authenticated denied (sin policy = default-deny).
 * - INSERT por service-role permitido (bypasa RLS).
 * - UPDATE bloqueado por trigger inmutabilidad.
 * - DELETE bloqueado por trigger inmutabilidad.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
const slugA = `t031-nl-a-${runId}`;
const slugB = `t031-nl-b-${runId}`;
const emailOwnerA = `t031-nl-owner-a-${runId}@example.com`;
const emailMemberA = `t031-nl-member-a-${runId}@example.com`;
const emailOwnerB = `t031-nl-owner-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let clientMemberA: SupabaseClient<Database>;
let clientOwnerB: SupabaseClient<Database>;

/** Notification log row pre-creada en cA via admin. */
let logFixtureId: string;

beforeAll(async () => {
  const [{ data: cA }, { data: cB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'T031 NL cA', slug: slugA }).select('id').single(),
    admin.from('consultoras').insert({ name: 'T031 NL cB', slug: slugB }).select('id').single(),
  ]);
  cAId = cA!.id;
  cBId = cB!.id;

  const [{ data: uOA }, { data: uMA }, { data: uOB }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailMemberA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true }),
  ]);
  ownerAId = uOA.user!.id;
  memberAId = uMA.user!.id;
  ownerBId = uOB.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await Promise.all([
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  const sbMA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbOB = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await Promise.all([
    sbMA.auth.signInWithPassword({ email: emailMemberA, password }),
    sbOB.auth.signInWithPassword({ email: emailOwnerB, password }),
  ]);
  clientMemberA = sbMA;
  clientOwnerB = sbOB;

  // Log fixture via admin (sin reminder/event vinculados — el test no
  // necesita el event chain entero para verificar RLS de log).
  const { data: log } = await admin
    .from('notification_log')
    .insert({
      consultora_id: cAId,
      recipient_user_id: ownerAId,
      channel: 'email',
      status: 'sent',
      provider_message_id: 'rsd_test_fixture',
    })
    .select('id')
    .single();
  logFixtureId = log!.id;
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
  ]);
});

describe('notification_log RLS', () => {
  it('1. SELECT same-tenant member ve el log', async () => {
    const { data } = await clientMemberA
      .from('notification_log')
      .select('id, channel, status')
      .eq('id', logFixtureId)
      .maybeSingle();

    expect(data?.id).toBe(logFixtureId);
    expect(data?.channel).toBe('email');
  });

  it('2. SELECT cross-tenant devuelve null', async () => {
    const { data } = await clientOwnerB
      .from('notification_log')
      .select('id')
      .eq('id', logFixtureId)
      .maybeSingle();

    expect(data).toBeNull();
  });

  it('3. INSERT por authenticated bloqueado (sin policy = default-deny)', async () => {
    const { error } = await clientMemberA.from('notification_log').insert({
      consultora_id: cAId,
      recipient_user_id: memberAId,
      channel: 'email',
      status: 'sent',
    });

    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('4. INSERT por service-role funciona', async () => {
    const { data, error } = await admin
      .from('notification_log')
      .insert({
        consultora_id: cAId,
        channel: 'telegram',
        status: 'skipped',
        error_code: 'NO_CHANNEL_IMPL_T033',
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });
});

describe('notification_log inmutabilidad', () => {
  it('5. UPDATE bloqueado por trigger (incluso service-role)', async () => {
    const { error } = await admin
      .from('notification_log')
      .update({ status: 'failed' })
      .eq('id', logFixtureId);

    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/inmutable/);
  });

  it('6. DELETE bloqueado por trigger (incluso service-role)', async () => {
    const { error } = await admin.from('notification_log').delete().eq('id', logFixtureId);

    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/inmutable/);
  });

  it('7. UPDATE por authenticated bloqueado (RLS antes que trigger)', async () => {
    // Member trata de update sus propios logs (intent legitimo: marcar visto?).
    // Resultado: 0 rows afectados por RLS default-deny en UPDATE policy
    // (no hay policy UPDATE para authenticated). Trigger no se llega a tocar.
    const { data, error } = await clientMemberA
      .from('notification_log')
      .update({ status: 'bounced' })
      .eq('id', logFixtureId)
      .select('id');

    // Sin policy UPDATE -> data vacio (RLS gateado). Sin error porque RLS
    // filtra silenciosamente en UPDATE/DELETE para authenticated.
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });
});
