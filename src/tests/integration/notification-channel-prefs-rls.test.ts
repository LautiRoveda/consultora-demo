/**
 * T-031 · RLS + trigger default + backfill de `notification_channel_prefs`.
 *
 * Cobertura:
 * - Trigger `ensure_default_email_pref_after_member_insert`: al insertar
 *   un consultora_members row, se crea automaticamente prefs.email enabled.
 * - SELECT/INSERT/UPDATE policies (user_id = auth.uid()).
 * - DELETE default-deny (sin policy).
 * - Cross-user denied (ownerA no ve/modifica prefs de ownerB).
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
const slugA = `t031-ncp-a-${runId}`;
const slugB = `t031-ncp-b-${runId}`;
const emailOwnerA = `t031-ncp-owner-a-${runId}@example.com`;
const emailMemberA = `t031-ncp-member-a-${runId}@example.com`;
const emailOwnerB = `t031-ncp-owner-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
// clientOwnerA es el unico necesario: los tests cross-user filtran por
// user_id=ownerBId desde clientOwnerA y verifican que RLS bloquea/devuelve
// vacio. ownerB existe en DB pero no necesita session client.
let clientOwnerA: SupabaseClient<Database>;

beforeAll(async () => {
  const [{ data: cA }, { data: cB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'T031 NCP cA', slug: slugA }).select('id').single(),
    admin.from('consultoras').insert({ name: 'T031 NCP cB', slug: slugB }).select('id').single(),
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

  // Insertar consultora_members dispara el trigger ensure_default_email_pref.
  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  const sbOA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await sbOA.auth.signInWithPassword({ email: emailOwnerA, password });
  clientOwnerA = sbOA;
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
  ]);
});

describe('notification_channel_prefs trigger', () => {
  it('1. AFTER INSERT en consultora_members crea row default email-enabled', async () => {
    // Trigger se disparo en beforeAll. Verificar las 3 rows.
    const { data: rows } = await admin
      .from('notification_channel_prefs')
      .select('user_id, channel, enabled, muted_until')
      .in('user_id', [ownerAId, memberAId, ownerBId])
      .eq('channel', 'email');

    expect(rows).toHaveLength(3);
    for (const row of rows!) {
      expect(row.channel).toBe('email');
      expect(row.enabled).toBe(true);
      expect(row.muted_until).toBeNull();
    }
  });

  it('2. ON CONFLICT DO NOTHING: re-insertar member no duplica prefs', async () => {
    // El user ownerA tiene MVP single-tenant. No podemos hacer un INSERT
    // duplicado de consultora_members (UNIQUE constraint user_id+consultora_id).
    // En su lugar, verificamos que el backfill de la migration + el trigger
    // del INSERT en beforeAll no duplicaron.
    const { count } = await admin
      .from('notification_channel_prefs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ownerAId)
      .eq('channel', 'email');

    expect(count).toBe(1);
  });
});

describe('notification_channel_prefs RLS', () => {
  it('3. SELECT propios funciona', async () => {
    const { data } = await clientOwnerA
      .from('notification_channel_prefs')
      .select('channel, enabled')
      .eq('user_id', ownerAId);

    expect(data).toHaveLength(1);
    expect(data![0]!.channel).toBe('email');
  });

  it('4. SELECT ajenos devuelve vacio (cross-user denied)', async () => {
    // ownerA filtra explicitamente por user_id de ownerB.
    const { data } = await clientOwnerA
      .from('notification_channel_prefs')
      .select('id')
      .eq('user_id', ownerBId);

    expect(data).toEqual([]);
  });

  it('5. UPDATE propio funciona (enabled -> false)', async () => {
    const { data, error } = await clientOwnerA
      .from('notification_channel_prefs')
      .update({ enabled: false })
      .eq('user_id', ownerAId)
      .eq('channel', 'email')
      .select('enabled')
      .single();

    expect(error).toBeNull();
    expect(data?.enabled).toBe(false);

    // Rollback para tests siguientes.
    await admin
      .from('notification_channel_prefs')
      .update({ enabled: true })
      .eq('user_id', ownerAId)
      .eq('channel', 'email');
  });

  it('6. UPDATE ajeno bloqueado (cross-user)', async () => {
    const { data } = await clientOwnerA
      .from('notification_channel_prefs')
      .update({ enabled: false })
      .eq('user_id', ownerBId)
      .eq('channel', 'email')
      .select('id');

    // Update sin error pero 0 rows afectados (RLS filtra antes).
    expect(data).toEqual([]);

    // Verificar via admin que ownerB sigue enabled=true.
    const { data: ownerBPref } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', ownerBId)
      .eq('channel', 'email')
      .single();
    expect(ownerBPref?.enabled).toBe(true);
  });

  it('7. INSERT propio funciona (telegram nuevo)', async () => {
    const { data, error } = await clientOwnerA
      .from('notification_channel_prefs')
      .insert({ user_id: ownerAId, channel: 'telegram', enabled: false })
      .select('id, channel, enabled')
      .single();

    expect(error).toBeNull();
    expect(data?.channel).toBe('telegram');
    expect(data?.enabled).toBe(false);

    await admin.from('notification_channel_prefs').delete().eq('id', data!.id);
  });

  it('8. INSERT ajeno bloqueado (user_id != auth.uid())', async () => {
    const { error } = await clientOwnerA
      .from('notification_channel_prefs')
      .insert({ user_id: ownerBId, channel: 'push', enabled: true });

    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('9. DELETE bloqueado para authenticated (default-deny)', async () => {
    const { data } = await clientOwnerA
      .from('notification_channel_prefs')
      .delete()
      .eq('user_id', ownerAId)
      .eq('channel', 'email')
      .select('id');

    // Sin policy DELETE -> 0 rows afectados (RLS default-deny).
    expect(data).toEqual([]);

    // Verificar via admin que la row sigue.
    const { data: stillThere } = await admin
      .from('notification_channel_prefs')
      .select('id')
      .eq('user_id', ownerAId)
      .eq('channel', 'email')
      .single();
    expect(stillThere?.id).toBeTruthy();
  });
});
