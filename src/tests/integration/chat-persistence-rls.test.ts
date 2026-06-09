/**
 * T-126 · Tests RLS de chat_conversaciones + chat_mensajes.
 *
 * El chat es PRIVADO POR USUARIO (no compartido en el tenant como clientes): las
 * policies exigen `is_member_of_consultora(consultora_id) AND user_id = auth.uid()`.
 * El caso estrella vs otros módulos: dos users del MISMO tenant NO se ven las
 * conversaciones entre sí.
 *
 * Cobertura:
 * - conversaciones: SELECT/INSERT/UPDATE per-user + cross-tenant + cross-user +
 *   spoof user_id + anon + DELETE default-deny.
 * - mensajes: append-only (SELECT+INSERT), EXISTS de dueño de la conversación,
 *   cross-tenant, cross-user, seq monotónico, cascade, CHECK content/role.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration src/tests/integration/chat-persistence-rls.test.ts`.
 */
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestConsultora } from './helpers/consultora';

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
const slugA = `t126-rls-a-${runId}`;
const slugB = `t126-rls-b-${runId}`;
const emailA1 = `t126-a1-${runId}@example.com`;
const emailA2 = `t126-a2-${runId}@example.com`;
const emailB = `t126-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let a1Id: string;
let a2Id: string;
let bId: string;

let clientA1: SupabaseClient<Database>;
let clientA2: SupabaseClient<Database>;
let clientB: SupabaseClient<Database>;
let clientAnon: SupabaseClient<Database>;

/** Conversación fixture de a1 (creada por a1, RLS-válida). */
let convA1Id: string;

async function signedClient(email: string): Promise<SupabaseClient<Database>> {
  const sb = createSbClient<Database>(url!, anonKey!, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return sb;
}

beforeAll(async () => {
  cAId = (await createTestConsultora(admin, { name: 'T126 RLS cA', slug: slugA })).id;
  cBId = (await createTestConsultora(admin, { name: 'T126 RLS cB', slug: slugB })).id;

  // Users secuenciales (Promise.all sobre auth.admin tiene flakiness en sa-east-1).
  const uA1 = await admin.auth.admin.createUser({ email: emailA1, password, email_confirm: true });
  if (uA1.error || !uA1.data.user) throw new Error(`createUser a1: ${JSON.stringify(uA1.error)}`);
  a1Id = uA1.data.user.id;
  const uA2 = await admin.auth.admin.createUser({ email: emailA2, password, email_confirm: true });
  if (uA2.error || !uA2.data.user) throw new Error(`createUser a2: ${JSON.stringify(uA2.error)}`);
  a2Id = uA2.data.user.id;
  const uB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (uB.error || !uB.data.user) throw new Error(`createUser b: ${JSON.stringify(uB.error)}`);
  bId = uB.data.user.id;

  // Memberships: a1 + a2 en cA (mismo tenant, distintos users); b owner en cB.
  await admin.from('consultora_members').insert([
    { user_id: a1Id, consultora_id: cAId, role: 'member' },
    { user_id: a2Id, consultora_id: cAId, role: 'member' },
    { user_id: bId, consultora_id: cBId, role: 'owner' },
  ]);

  // Claim JWT ANTES del sign-in (el claim se hornea al emitir el token).
  await admin.auth.admin.updateUserById(a1Id, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(a2Id, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(bId, { app_metadata: { consultora_id: cBId } });

  clientA1 = await signedClient(emailA1);
  clientA2 = await signedClient(emailA2);
  clientB = await signedClient(emailB);
  clientAnon = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });

  // Fixture: conversación de a1 (vía su client → RLS-válida).
  const { data: conv, error } = await clientA1
    .from('chat_conversaciones')
    .insert({ consultora_id: cAId, user_id: a1Id, titulo: 'Conversación de a1' })
    .select('id')
    .single();
  if (error || !conv) throw new Error(`fixture conv a1: ${JSON.stringify(error)}`);
  convA1Id = conv.id;
});

afterAll(async () => {
  // Borrar users cascadea consultora_members + chat_conversaciones (user_id) +
  // chat_mensajes (cascade de la conversación). Las consultoras quedan orphan
  // (retención de audit_log, igual que el resto de los tests).
  await Promise.all([
    admin.auth.admin.deleteUser(a1Id).catch(() => {}),
    admin.auth.admin.deleteUser(a2Id).catch(() => {}),
    admin.auth.admin.deleteUser(bId).catch(() => {}),
  ]);
});

describe('chat_conversaciones RLS', () => {
  it('1. a1 inserta su propia conversación', async () => {
    const { data, error } = await clientA1
      .from('chat_conversaciones')
      .insert({ consultora_id: cAId, user_id: a1Id, titulo: 'otra de a1' })
      .select('id, consultora_id, user_id')
      .single();
    expect(error).toBeNull();
    expect(data?.consultora_id).toBe(cAId);
    expect(data?.user_id).toBe(a1Id);
  });

  it('2. a1 NO puede insertar con consultora_id de otro tenant (cB)', async () => {
    const { error } = await clientA1
      .from('chat_conversaciones')
      .insert({ consultora_id: cBId, user_id: a1Id, titulo: 'cross-tenant' });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('3. a1 NO puede spoofear user_id = a2', async () => {
    const { error } = await clientA1
      .from('chat_conversaciones')
      .insert({ consultora_id: cAId, user_id: a2Id, titulo: 'spoof user' });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('4. a2 NO ve la conversación de a1 (mismo tenant, distinto user)', async () => {
    const { data, error } = await clientA2
      .from('chat_conversaciones')
      .select('id')
      .eq('id', convA1Id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('5. b NO ve la conversación de a1 (cross-tenant)', async () => {
    const { data, error } = await clientB
      .from('chat_conversaciones')
      .select('id')
      .eq('id', convA1Id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('6. anon (sin sesión) NO puede consultar', async () => {
    const { data, error } = await clientAnon
      .from('chat_conversaciones')
      .select('id')
      .eq('id', convA1Id)
      .maybeSingle();
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('7. a1 archiva su conversación; a2 NO puede (0 rows)', async () => {
    const { data: ok, error: e1 } = await clientA1
      .from('chat_conversaciones')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', convA1Id)
      .select('id');
    expect(e1).toBeNull();
    expect(ok?.length).toBe(1);

    // Reactivar para no romper otros tests (fixture vuelve a estar activa).
    await clientA1.from('chat_conversaciones').update({ archived_at: null }).eq('id', convA1Id);

    const { data: a2Try, error: e2 } = await clientA2
      .from('chat_conversaciones')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', convA1Id)
      .select('id');
    expect(e2).toBeNull();
    expect(a2Try?.length ?? 0).toBe(0);
  });

  it('8. a1 NO puede DELETE su conversación (sin policy DELETE → 0 rows)', async () => {
    const { data: fresh } = await clientA1
      .from('chat_conversaciones')
      .insert({ consultora_id: cAId, user_id: a1Id, titulo: 'para borrar' })
      .select('id')
      .single();
    const freshId = fresh!.id;

    const { data, error } = await clientA1
      .from('chat_conversaciones')
      .delete()
      .eq('id', freshId)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    // Sigue ahí (verificado via admin).
    const { data: still } = await admin
      .from('chat_conversaciones')
      .select('id')
      .eq('id', freshId)
      .maybeSingle();
    expect(still?.id).toBe(freshId);
  });
});

describe('chat_mensajes RLS', () => {
  it('9. a1 inserta user+assistant en su conversación; seq(assistant) > seq(user)', async () => {
    const { data, error } = await clientA1
      .from('chat_mensajes')
      .insert([
        {
          conversacion_id: convA1Id,
          consultora_id: cAId,
          user_id: a1Id,
          role: 'user',
          content: 'hola',
        },
        {
          conversacion_id: convA1Id,
          consultora_id: cAId,
          user_id: a1Id,
          role: 'assistant',
          content: 'qué tal',
        },
      ])
      .select('role, seq');
    expect(error).toBeNull();
    expect(data?.length).toBe(2);
    const userSeq = data!.find((m) => m.role === 'user')!.seq;
    const asstSeq = data!.find((m) => m.role === 'assistant')!.seq;
    expect(asstSeq).toBeGreaterThan(userSeq);
  });

  it('10. a2 NO puede insertar mensajes en la conversación de a1 (EXISTS de dueño)', async () => {
    const { error } = await clientA2.from('chat_mensajes').insert({
      conversacion_id: convA1Id,
      consultora_id: cAId,
      user_id: a2Id,
      role: 'user',
      content: 'intruso',
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('11. b NO puede insertar mensajes (cross-tenant: no es member de cA)', async () => {
    const { error } = await clientB.from('chat_mensajes').insert({
      conversacion_id: convA1Id,
      consultora_id: cAId,
      user_id: bId,
      role: 'user',
      content: 'cross-tenant',
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('12. a2 NO ve los mensajes de la conversación de a1', async () => {
    const { data, error } = await clientA2
      .from('chat_mensajes')
      .select('id')
      .eq('conversacion_id', convA1Id);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('13. a1 NO puede UPDATE ni DELETE mensajes (append-only → 0 rows)', async () => {
    const { data: msg } = await clientA1
      .from('chat_mensajes')
      .select('id')
      .eq('conversacion_id', convA1Id)
      .limit(1)
      .maybeSingle();
    expect(msg?.id).toBeDefined();

    const { data: upd, error: eUpd } = await clientA1
      .from('chat_mensajes')
      .update({ content: 'editado' })
      .eq('id', msg!.id)
      .select('id');
    expect(eUpd).toBeNull();
    expect(upd?.length ?? 0).toBe(0);

    const { data: del, error: eDel } = await clientA1
      .from('chat_mensajes')
      .delete()
      .eq('id', msg!.id)
      .select('id');
    expect(eDel).toBeNull();
    expect(del?.length ?? 0).toBe(0);
  });

  it('14. borrar la conversación cascadea sus mensajes', async () => {
    const { data: conv } = await clientA1
      .from('chat_conversaciones')
      .insert({ consultora_id: cAId, user_id: a1Id, titulo: 'a cascadear' })
      .select('id')
      .single();
    const convId = conv!.id;
    await clientA1.from('chat_mensajes').insert([
      { conversacion_id: convId, consultora_id: cAId, user_id: a1Id, role: 'user', content: 'q' },
      {
        conversacion_id: convId,
        consultora_id: cAId,
        user_id: a1Id,
        role: 'assistant',
        content: 'a',
      },
    ]);

    // Hard-delete via admin (service_role) → cascade a chat_mensajes.
    const { error: eDel } = await admin.from('chat_conversaciones').delete().eq('id', convId);
    expect(eDel).toBeNull();

    const { data: msgs } = await admin
      .from('chat_mensajes')
      .select('id')
      .eq('conversacion_id', convId);
    expect(msgs?.length ?? 0).toBe(0);
  });

  it('15. CHECK: content vacío / >8000 / role inválido → 23514', async () => {
    const empty = await clientA1.from('chat_mensajes').insert({
      conversacion_id: convA1Id,
      consultora_id: cAId,
      user_id: a1Id,
      role: 'user',
      content: '',
    });
    expect(empty.error?.code).toBe('23514');

    const tooLong = await clientA1.from('chat_mensajes').insert({
      conversacion_id: convA1Id,
      consultora_id: cAId,
      user_id: a1Id,
      role: 'assistant',
      content: 'x'.repeat(8001),
    });
    expect(tooLong.error?.code).toBe('23514');

    const badRole = await clientA1.from('chat_mensajes').insert({
      conversacion_id: convA1Id,
      consultora_id: cAId,
      user_id: a1Id,
      role: 'system',
      content: 'rol inválido',
    });
    expect(badRole.error?.code).toBe('23514');
  });
});
