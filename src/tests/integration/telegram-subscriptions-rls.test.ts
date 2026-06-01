/**
 * T-033 · RLS + audit trigger de `telegram_subscriptions`.
 *
 * Cobertura:
 *  - SELECT/INSERT/UPDATE policies (user_id = auth.uid()).
 *  - DELETE default-deny (sin policy authenticated).
 *  - Service-role bypassea RLS (necesario para webhook handler que hace
 *    claim cross-user via link_code lookup).
 *  - Cross-user denied: clientUserA no ve/modifica rows de userB.
 *  - audit_trigger INSERT: escribe row con shape esperado.
 *  - audit_trigger UPDATE diff guard: solo audit si cambia
 *    linked_at/unlinked_at/blocked_count/telegram_chat_id.
 *  - audit_trigger NUNCA incluye link_code en payload (security).
 *  - audit_log.consultora_id puede ser null (ajuste T-011 forzado por T-033).
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
const slugA = `t033-tg-a-${runId}`;
const emailUserA = `t033-tg-userA-${runId}@example.com`;
const emailUserB = `t033-tg-userB-${runId}@example.com`;
const password = 'TestPassword123!';

// Helper para generar link_codes únicos por test sin riesgo de colisión con
// rows huérfanas de runs previos abortados (kill -9 → afterAll no corre →
// users borrados manualmente pero rows TG sobreviven si cascade falla).
function code(suffix: string): string {
  return `T${runId}${suffix}`.toUpperCase().slice(0, 16);
}

let cAId: string;
let userAId: string;
let userBId: string;
let clientUserA: SupabaseClient<Database>;

beforeAll(async () => {
  const { data: cA } = await admin
    .from('consultoras')
    .insert({ name: 'T033 TG cA', slug: slugA })
    .select('id')
    .single();
  cAId = cA!.id;

  const [{ data: uA }, { data: uB }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailUserA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailUserB, password, email_confirm: true }),
  ]);
  userAId = uA.user!.id;
  userBId = uB.user!.id;

  // Solo userA tiene membership — userB queda como user "huérfano" para
  // el escenario "subscription sin contexto consultora" (audit_log con null).
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

// Cleanup robusto entre tests: borra cualquier row residual de telegram_subscriptions de
// userA/userB. Es necesario porque user_id es UNIQUE — un INSERT fallido con `.single()`
// devuelve `data: null` y el `created!.id` tira `Cannot read properties of null`, pero el
// INSERT real podría haber creado el row si el assert previo falló (transaction rollback
// parcial vs flush DB cache).
// audit_log es append-only/inmutable: no se limpia; las queries scopean por entity_id +
// action, así que las filas residuales son invisibles (ver T-113b).
beforeEach(async () => {
  await admin.from('telegram_subscriptions').delete().in('user_id', [userAId, userBId]);
});

describe('telegram_subscriptions RLS', () => {
  it('1. SELECT propio funciona', async () => {
    // Insert via admin para tener row del userA.
    const { data: inserted } = await admin
      .from('telegram_subscriptions')
      .insert({ user_id: userAId, link_code: code('T1') })
      .select('id')
      .single();

    const { data: rows } = await clientUserA
      .from('telegram_subscriptions')
      .select('id, user_id, link_code')
      .eq('user_id', userAId);

    expect(rows).toHaveLength(1);
    expect(rows![0]!.user_id).toBe(userAId);

    await admin.from('telegram_subscriptions').delete().eq('id', inserted!.id);
  });

  it('2. SELECT ajenos devuelve vacío (cross-user denied)', async () => {
    const { data: insertedB } = await admin
      .from('telegram_subscriptions')
      .insert({ user_id: userBId, link_code: code('T2') })
      .select('id')
      .single();

    const { data: rows } = await clientUserA
      .from('telegram_subscriptions')
      .select('id')
      .eq('user_id', userBId);

    expect(rows).toEqual([]);

    await admin.from('telegram_subscriptions').delete().eq('id', insertedB!.id);
  });

  it('3. INSERT propio funciona', async () => {
    const { data, error } = await clientUserA
      .from('telegram_subscriptions')
      .insert({ user_id: userAId, link_code: code('T3') })
      .select('id, user_id')
      .single();

    expect(error).toBeNull();
    expect(data?.user_id).toBe(userAId);

    await admin.from('telegram_subscriptions').delete().eq('id', data!.id);
  });

  it('4. INSERT ajeno bloqueado (user_id != auth.uid())', async () => {
    const { error } = await clientUserA
      .from('telegram_subscriptions')
      .insert({ user_id: userBId, link_code: code('T4') });

    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('5. UPDATE propio funciona (linked_at)', async () => {
    const { data: created } = await admin
      .from('telegram_subscriptions')
      .insert({ user_id: userAId, link_code: code('T5') })
      .select('id')
      .single();

    const linkedAt = new Date().toISOString();
    const { error } = await clientUserA
      .from('telegram_subscriptions')
      .update({ linked_at: linkedAt, telegram_chat_id: 999_999 })
      .eq('id', created!.id);

    expect(error).toBeNull();

    const { data: after } = await admin
      .from('telegram_subscriptions')
      .select('linked_at, telegram_chat_id')
      .eq('id', created!.id)
      .single();
    // Normalizamos a ISO porque Postgres devuelve `+00:00` y JS toISOString `Z`.
    expect(new Date(after!.linked_at!).toISOString()).toBe(linkedAt);
    expect(after?.telegram_chat_id).toBe(999_999);

    await admin.from('telegram_subscriptions').delete().eq('id', created!.id);
  });

  it('6. UPDATE ajeno bloqueado (cross-user)', async () => {
    const { data: createdB } = await admin
      .from('telegram_subscriptions')
      .insert({ user_id: userBId, link_code: code('T6') })
      .select('id, linked_at')
      .single();

    const { data: updated } = await clientUserA
      .from('telegram_subscriptions')
      .update({ linked_at: new Date().toISOString() })
      .eq('id', createdB!.id)
      .select('id');

    expect(updated).toEqual([]);

    // Verificar via admin que userB sigue con linked_at null.
    const { data: stillNull } = await admin
      .from('telegram_subscriptions')
      .select('linked_at')
      .eq('id', createdB!.id)
      .single();
    expect(stillNull?.linked_at).toBeNull();

    await admin.from('telegram_subscriptions').delete().eq('id', createdB!.id);
  });

  it('7. DELETE bloqueado para authenticated (default-deny)', async () => {
    const { data: created } = await admin
      .from('telegram_subscriptions')
      .insert({ user_id: userAId, link_code: code('T7') })
      .select('id')
      .single();

    const { data } = await clientUserA
      .from('telegram_subscriptions')
      .delete()
      .eq('id', created!.id)
      .select('id');

    // Sin policy DELETE → 0 rows afectados (RLS default-deny).
    expect(data).toEqual([]);

    const { data: stillThere } = await admin
      .from('telegram_subscriptions')
      .select('id')
      .eq('id', created!.id)
      .single();
    expect(stillThere?.id).toBe(created!.id);

    await admin.from('telegram_subscriptions').delete().eq('id', created!.id);
  });

  it('8. service-role bypassea RLS (necesario para webhook lookup cross-user)', async () => {
    // Admin lookup por link_code sin saber user_id (patrón del webhook handler).
    const { data: createdB } = await admin
      .from('telegram_subscriptions')
      .insert({
        user_id: userBId,
        link_code: code('T8'),
        link_code_expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .select('id, user_id')
      .single();

    const { data: lookup } = await admin
      .from('telegram_subscriptions')
      .select('id, user_id')
      .eq('link_code', code('T8'))
      .maybeSingle();

    expect(lookup?.user_id).toBe(userBId);

    await admin.from('telegram_subscriptions').delete().eq('id', createdB!.id);
  });
});

describe('telegram_subscriptions audit trigger', () => {
  it('9. INSERT escribe audit row con consultora_id=null + shape correcto', async () => {
    const { data: inserted } = await admin
      .from('telegram_subscriptions')
      .insert({ user_id: userAId, link_code: code('A1') })
      .select('id')
      .single();

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, consultora_id, before_data, after_data')
      .eq('entity_id', inserted!.id)
      .eq('action', 'telegram_subscription_created');

    expect(auditRows).toHaveLength(1);
    const row = auditRows![0]!;
    expect(row.entity_type).toBe('telegram_subscription');
    expect(row.consultora_id).toBeNull(); // ← ajuste T-011 funcionando
    expect(row.before_data).toBeNull();
    expect(row.after_data).toEqual({ user_id: userAId });
    // link_code NO debe estar en el payload (security).
    expect(JSON.stringify(row.after_data)).not.toContain(code('A1'));

    await admin.from('telegram_subscriptions').delete().eq('id', inserted!.id);
  });

  it('10. UPDATE diff guard: cambio en linked_at SI escribe audit row', async () => {
    const { data: created } = await admin
      .from('telegram_subscriptions')
      .insert({ user_id: userAId, link_code: code('A2') })
      .select('id')
      .single();

    const linkedAt = new Date().toISOString();
    await admin
      .from('telegram_subscriptions')
      .update({ linked_at: linkedAt, telegram_chat_id: 12345 })
      .eq('id', created!.id);

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('action, before_data, after_data')
      .eq('entity_id', created!.id)
      .eq('action', 'telegram_subscription_updated');

    expect(auditRows).toHaveLength(1);
    const row = auditRows![0]!;
    expect(row.before_data).toMatchObject({ linked_at: null, chat_id_was_set: false });
    // Normalizar linked_at del audit (Postgres +00:00 → JS Z) para comparar.
    const afterData = row.after_data as Record<string, unknown>;
    expect(new Date(afterData.linked_at as string).toISOString()).toBe(linkedAt);
    expect(afterData.chat_id_is_set).toBe(true);
    // El chat_id real (PII) NO debe estar en el payload.
    expect(JSON.stringify(row.after_data)).not.toContain('12345');

    await admin.from('telegram_subscriptions').delete().eq('id', created!.id);
  });

  it('11. UPDATE diff guard: cambio solo en link_code NO escribe audit row', async () => {
    const { data: created } = await admin
      .from('telegram_subscriptions')
      .insert({ user_id: userAId, link_code: code('A3') })
      .select('id')
      .single();

    // UPDATE solo el link_code (regenerar código sin cambiar linked_at etc).
    await admin
      .from('telegram_subscriptions')
      .update({ link_code: code('A4') })
      .eq('id', created!.id);

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('id')
      .eq('entity_id', created!.id)
      .eq('action', 'telegram_subscription_updated');

    // El diff guard solo audita linked_at/unlinked_at/blocked_count/chat_id.
    // link_code NO está en la lista — cambio aislado no debe disparar audit.
    expect(auditRows).toEqual([]);

    await admin.from('telegram_subscriptions').delete().eq('id', created!.id);
  });

  it('12. UPDATE diff guard: blocked_count incrementa SI escribe audit row', async () => {
    const { data: created } = await admin
      .from('telegram_subscriptions')
      .insert({ user_id: userAId, link_code: code('A5') })
      .select('id')
      .single();

    await admin.from('telegram_subscriptions').update({ blocked_count: 1 }).eq('id', created!.id);

    const { data: auditRows } = await admin
      .from('audit_log')
      .select('before_data, after_data')
      .eq('entity_id', created!.id)
      .eq('action', 'telegram_subscription_updated');

    expect(auditRows).toHaveLength(1);
    expect(auditRows![0]!.before_data).toMatchObject({ blocked_count: 0 });
    expect(auditRows![0]!.after_data).toMatchObject({ blocked_count: 1 });

    await admin.from('telegram_subscriptions').delete().eq('id', created!.id);
  });

  it('13. CASCADE delete: auth.users delete borra telegram_subscriptions', async () => {
    // Crear user temporal para no afectar userA/userB.
    const tempEmail = `t033-tg-cascade-${runId}@example.com`;
    const { data: u } = await admin.auth.admin.createUser({
      email: tempEmail,
      password,
      email_confirm: true,
    });
    const tempUserId = u.user!.id;

    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .insert({ user_id: tempUserId, link_code: code('CX') })
      .select('id')
      .single();

    await admin.auth.admin.deleteUser(tempUserId);

    const { data: orphan } = await admin
      .from('telegram_subscriptions')
      .select('id')
      .eq('id', sub!.id)
      .maybeSingle();
    expect(orphan).toBeNull();
  });
});
