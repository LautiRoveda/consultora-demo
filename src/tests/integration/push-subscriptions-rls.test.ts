/**
 * T-034 · RLS + audit trigger de `push_subscriptions`.
 *
 * Cobertura:
 *  - SELECT/INSERT/DELETE policies (user_id = auth.uid()).
 *  - UPDATE default-deny (sin policy authenticated — sender service-role only).
 *  - Cross-user denied: clientUserA no ve/modifica rows de userB.
 *  - audit_trigger INSERT: escribe row con shape esperado + consultora_id=null.
 *  - audit_trigger DELETE: escribe row con before_data.
 *  - Payload audit NUNCA incluye endpoint/p256dh_key/auth_key (PII + secret).
 *  - cascade delete via auth.users borra subs.
 *  - UNIQUE (user_id, endpoint) idempotente.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
const slugA = `t034-push-a-${runId}`;
const emailUserA = `t034-push-userA-${runId}@example.com`;
const emailUserB = `t034-push-userB-${runId}@example.com`;
const password = 'TestPassword123!';

// Helper para endpoints únicos por test (mockean URLs de FCM/Mozilla autopush).
function endpoint(suffix: string): string {
  return `https://fcm.googleapis.com/fcm/send/t034-${runId}-${suffix}`;
}

let cAId: string;
let userAId: string;
let userBId: string;
let clientUserA: SupabaseClient<Database>;

beforeAll(async () => {
  const { data: cA } = await admin
    .from('consultoras')
    .insert({ name: 'T034 push cA', slug: slugA })
    .select('id')
    .single();
  cAId = cA!.id;

  const [{ data: uA }, { data: uB }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailUserA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailUserB, password, email_confirm: true }),
  ]);
  userAId = uA.user!.id;
  userBId = uB.user!.id;

  await admin.from('consultora_members').insert({
    user_id: userAId,
    consultora_id: cAId,
    role: 'owner',
  });

  await admin.auth.admin.updateUserById(userAId, {
    app_metadata: { consultora_id: cAId },
  });

  const sbA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await sbA.auth.signInWithPassword({ email: emailUserA, password });
  clientUserA = sbA;
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(userAId).catch(() => {}),
    admin.auth.admin.deleteUser(userBId).catch(() => {}),
  ]);
});

// Cleanup robusto: borra subs y audit_log derivados de userA/userB.
beforeEach(async () => {
  await admin.from('push_subscriptions').delete().in('user_id', [userAId, userBId]);
  await admin
    .from('audit_log')
    .delete()
    .eq('entity_type', 'push_subscription')
    .in('actor_user_id', [userAId, userBId]);
});

describe('push_subscriptions RLS', () => {
  it('1. SELECT propio funciona', async () => {
    await admin.from('push_subscriptions').insert({
      user_id: userAId,
      endpoint: endpoint('S1'),
      p256dh_key: 'fake-p256dh-key',
      auth_key: 'fake-auth-key',
      user_agent: 'TestAgent',
    });

    const { data: rows } = await clientUserA
      .from('push_subscriptions')
      .select('id, user_id, endpoint')
      .eq('user_id', userAId);

    expect(rows).toHaveLength(1);
    expect(rows![0]!.user_id).toBe(userAId);
  });

  it('2. SELECT ajenos devuelve vacío (cross-user denied)', async () => {
    await admin.from('push_subscriptions').insert({
      user_id: userBId,
      endpoint: endpoint('S2'),
      p256dh_key: 'fake-p256dh-key',
      auth_key: 'fake-auth-key',
    });

    const { data: rows } = await clientUserA
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', userBId);

    expect(rows).toEqual([]);
  });

  it('3. INSERT propio funciona', async () => {
    const { data, error } = await clientUserA
      .from('push_subscriptions')
      .insert({
        user_id: userAId,
        endpoint: endpoint('S3'),
        p256dh_key: 'fake-p256dh-key',
        auth_key: 'fake-auth-key',
      })
      .select('id, user_id')
      .single();

    expect(error).toBeNull();
    expect(data?.user_id).toBe(userAId);
  });

  it('4. INSERT ajeno bloqueado (user_id spoof RLS)', async () => {
    const { error } = await clientUserA.from('push_subscriptions').insert({
      user_id: userBId,
      endpoint: endpoint('S4'),
      p256dh_key: 'fake-p256dh-key',
      auth_key: 'fake-auth-key',
    });

    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('5. UPDATE default-deny para authenticated', async () => {
    const { data: created } = await admin
      .from('push_subscriptions')
      .insert({
        user_id: userAId,
        endpoint: endpoint('S5'),
        p256dh_key: 'fake-p256dh-key',
        auth_key: 'fake-auth-key',
      })
      .select('id, last_seen_at')
      .single();

    const lastSeenBefore = created!.last_seen_at;

    // Sin policy UPDATE → 0 rows afectados (RLS default-deny).
    const { data: updated } = await clientUserA
      .from('push_subscriptions')
      .update({ last_seen_at: new Date(Date.now() - 86400_000).toISOString() })
      .eq('id', created!.id)
      .select('id');

    expect(updated).toEqual([]);

    // Verificar via admin que last_seen_at NO cambió.
    const { data: after } = await admin
      .from('push_subscriptions')
      .select('last_seen_at')
      .eq('id', created!.id)
      .single();
    expect(after?.last_seen_at).toBe(lastSeenBefore);
  });

  it('6. DELETE propio funciona', async () => {
    const { data: created } = await admin
      .from('push_subscriptions')
      .insert({
        user_id: userAId,
        endpoint: endpoint('S6'),
        p256dh_key: 'fake-p256dh-key',
        auth_key: 'fake-auth-key',
      })
      .select('id')
      .single();

    const { data: deleted } = await clientUserA
      .from('push_subscriptions')
      .delete()
      .eq('id', created!.id)
      .select('id');

    expect(deleted).toHaveLength(1);

    const { data: stillThere } = await admin
      .from('push_subscriptions')
      .select('id')
      .eq('id', created!.id)
      .maybeSingle();
    expect(stillThere).toBeNull();
  });

  it('7. DELETE ajeno bloqueado (cross-user)', async () => {
    const { data: createdB } = await admin
      .from('push_subscriptions')
      .insert({
        user_id: userBId,
        endpoint: endpoint('S7'),
        p256dh_key: 'fake-p256dh-key',
        auth_key: 'fake-auth-key',
      })
      .select('id')
      .single();

    const { data: deleted } = await clientUserA
      .from('push_subscriptions')
      .delete()
      .eq('id', createdB!.id)
      .select('id');

    expect(deleted).toEqual([]);

    // Verificar via admin que userB todavía tiene la row.
    const { data: stillThere } = await admin
      .from('push_subscriptions')
      .select('id')
      .eq('id', createdB!.id)
      .single();
    expect(stillThere?.id).toBe(createdB!.id);
  });

  it('8. UNIQUE (user_id, endpoint): segundo INSERT mismo endpoint falla', async () => {
    const sameEndpoint = endpoint('UNIQ');
    await admin.from('push_subscriptions').insert({
      user_id: userAId,
      endpoint: sameEndpoint,
      p256dh_key: 'fake-p256dh-key-1',
      auth_key: 'fake-auth-key-1',
    });

    const { error } = await admin.from('push_subscriptions').insert({
      user_id: userAId,
      endpoint: sameEndpoint,
      p256dh_key: 'fake-p256dh-key-2',
      auth_key: 'fake-auth-key-2',
    });

    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/duplicate|unique/);
  });
});

describe('push_subscriptions audit trigger', () => {
  it('9. INSERT escribe audit row con consultora_id=null + shape correcto', async () => {
    const { data: inserted } = await admin
      .from('push_subscriptions')
      .insert({
        user_id: userAId,
        endpoint: endpoint('A1'),
        p256dh_key: 'fake-p256dh-secret',
        auth_key: 'fake-auth-secret',
        user_agent: 'Mozilla/5.0 (Test)',
      })
      .select('id')
      .single();

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, consultora_id, before_data, after_data')
      .eq('entity_id', inserted!.id)
      .eq('action', 'push_subscription_created');

    expect(auditRows).toHaveLength(1);
    const row = auditRows![0]!;
    expect(row.entity_type).toBe('push_subscription');
    expect(row.consultora_id).toBeNull();
    expect(row.before_data).toBeNull();
    expect(row.after_data).toEqual({
      user_id: userAId,
      has_user_agent: true,
    });
    // endpoint, p256dh_key, auth_key NUNCA en payload (security).
    const payloadStr = JSON.stringify(row.after_data);
    expect(payloadStr).not.toContain(endpoint('A1'));
    expect(payloadStr).not.toContain('fake-p256dh-secret');
    expect(payloadStr).not.toContain('fake-auth-secret');
    expect(payloadStr).not.toContain('Mozilla/5.0');
  });

  it('10. INSERT sin user_agent → has_user_agent=false en audit', async () => {
    const { data: inserted } = await admin
      .from('push_subscriptions')
      .insert({
        user_id: userAId,
        endpoint: endpoint('A2'),
        p256dh_key: 'fake',
        auth_key: 'fake',
      })
      .select('id')
      .single();

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('after_data')
      .eq('entity_id', inserted!.id)
      .eq('action', 'push_subscription_created');

    expect(auditRows).toHaveLength(1);
    expect(auditRows![0]!.after_data).toEqual({
      user_id: userAId,
      has_user_agent: false,
    });
  });

  it('11. DELETE escribe audit row con before_data', async () => {
    const { data: created } = await admin
      .from('push_subscriptions')
      .insert({
        user_id: userAId,
        endpoint: endpoint('A3'),
        p256dh_key: 'fake',
        auth_key: 'fake',
        user_agent: 'TestAgent',
      })
      .select('id')
      .single();

    // Limpiar audit del INSERT.
    await admin.from('audit_log').delete().eq('entity_id', created!.id);

    await admin.from('push_subscriptions').delete().eq('id', created!.id);

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('action, before_data, after_data')
      .eq('entity_id', created!.id)
      .eq('action', 'push_subscription_deleted');

    expect(auditRows).toHaveLength(1);
    const row = auditRows![0]!;
    expect(row.before_data).toEqual({
      user_id: userAId,
      has_user_agent: true,
    });
    expect(row.after_data).toBeNull();
  });

  it('12. CASCADE delete: auth.users delete borra push_subscriptions', async () => {
    const tempEmail = `t034-push-cascade-${runId}@example.com`;
    const { data: u } = await admin.auth.admin.createUser({
      email: tempEmail,
      password,
      email_confirm: true,
    });
    const tempUserId = u.user!.id;

    const { data: sub } = await admin
      .from('push_subscriptions')
      .insert({
        user_id: tempUserId,
        endpoint: endpoint('CX'),
        p256dh_key: 'fake',
        auth_key: 'fake',
      })
      .select('id')
      .single();

    await admin.auth.admin.deleteUser(tempUserId);

    const { data: orphan } = await admin
      .from('push_subscriptions')
      .select('id')
      .eq('id', sub!.id)
      .maybeSingle();
    expect(orphan).toBeNull();
  });
});
