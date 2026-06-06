/**
 * T-126 · Tests integration de las server actions de persistencia del chat.
 *
 * Mockeamos next/headers (cookies), next/cache y el logger (igual que
 * asistente-route.test.ts) y firmamos usuarios reales para ejercitar
 * `persistChatTurnAction` / `archiveChatConversacionAction` con el supabase
 * RLS-aware de la sesión. Verificamos el resultado contra la DB via admin.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration src/tests/integration/persist-chat-turn-action.test.ts`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestConsultora } from './helpers/consultora';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
  cookies: () =>
    Promise.resolve({
      getAll: () => cookieStore.map((c) => ({ name: c.name, value: c.value })),
      set: (name: string, value: string) => {
        const idx = cookieStore.findIndex((c) => c.name === name);
        if (idx >= 0) cookieStore[idx] = { name, value };
        else cookieStore.push({ name, value });
      },
    }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  },
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error('Tests requieren env Supabase. Correr con .env.local cargado.');
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';
const slugA = `t126-act-a-${runId}`;
const slugB = `t126-act-b-${runId}`;
const emailA = `t126-act-a-${runId}@example.com`;
const emailB = `t126-act-b-${runId}@example.com`;

let cAId: string;
let cBId: string;
let userAId: string;
let userBId: string;

beforeAll(async () => {
  cAId = (await createTestConsultora(admin, { name: 'T126 Act cA', slug: slugA })).id;
  cBId = (await createTestConsultora(admin, { name: 'T126 Act cB', slug: slugB })).id;

  const uA = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  if (uA.error || !uA.data.user) throw new Error(`createUser a: ${JSON.stringify(uA.error)}`);
  userAId = uA.data.user.id;
  const uB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (uB.error || !uB.data.user) throw new Error(`createUser b: ${JSON.stringify(uB.error)}`);
  userBId = uB.data.user.id;

  await admin.from('consultora_members').insert([
    { user_id: userAId, consultora_id: cAId, role: 'owner' },
    { user_id: userBId, consultora_id: cBId, role: 'owner' },
  ]);
  await admin.auth.admin.updateUserById(userAId, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(userBId, { app_metadata: { consultora_id: cBId } });
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(userAId).catch(() => {}),
    admin.auth.admin.deleteUser(userBId).catch(() => {}),
  ]);
});

beforeEach(() => {
  cookieStore.length = 0;
});

const sessionCache = new Map<string, Array<{ name: string; value: string }>>();
async function signInAs(email: string): Promise<void> {
  cookieStore.length = 0;
  const cached = sessionCache.get(email);
  if (cached) {
    for (const c of cached) cookieStore.push({ ...c });
    return;
  }
  const { createClient: createServerClient } = await import('@/shared/supabase/server');
  const sb = await createServerClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  sessionCache.set(
    email,
    cookieStore.map((c) => ({ ...c })),
  );
}

describe('persistChatTurnAction', () => {
  it('1. conversacionId null → crea la conversación + 2 mensajes ordenados', async () => {
    await signInAs(emailA);
    const { persistChatTurnAction } = await import('@/app/(app)/asistente/actions');

    const res = await persistChatTurnAction({
      conversacionId: null,
      userMessage: '¿Qué EPP le vence a Pérez?',
      assistantMessage: 'A Pérez le vence el casco el 10/07/2026.',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { data: conv } = await admin
      .from('chat_conversaciones')
      .select('consultora_id, user_id, titulo')
      .eq('id', res.conversacionId)
      .single();
    expect(conv?.consultora_id).toBe(cAId);
    expect(conv?.user_id).toBe(userAId);
    expect(conv?.titulo).toBe('¿Qué EPP le vence a Pérez?');

    const { data: msgs } = await admin
      .from('chat_mensajes')
      .select('role, content, seq')
      .eq('conversacion_id', res.conversacionId)
      .order('seq', { ascending: true });
    expect(msgs?.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs?.[0]?.content).toBe('¿Qué EPP le vence a Pérez?');
    expect(msgs?.[1]?.content).toBe('A Pérez le vence el casco el 10/07/2026.');
  });

  it('2. conversacionId existente → appendea (no crea otra) y bumpea updated_at', async () => {
    await signInAs(emailA);
    const { persistChatTurnAction } = await import('@/app/(app)/asistente/actions');

    const first = await persistChatTurnAction({
      conversacionId: null,
      userMessage: 'primera',
      assistantMessage: 'respuesta 1',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await persistChatTurnAction({
      conversacionId: first.conversacionId,
      userMessage: 'segunda',
      assistantMessage: 'respuesta 2',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.conversacionId).toBe(first.conversacionId);

    const { data: msgs } = await admin
      .from('chat_mensajes')
      .select('role, content, seq')
      .eq('conversacion_id', first.conversacionId)
      .order('seq', { ascending: true });
    expect(msgs?.length).toBe(4);
    expect(msgs?.map((m) => m.content)).toEqual([
      'primera',
      'respuesta 1',
      'segunda',
      'respuesta 2',
    ]);

    const { data: conv } = await admin
      .from('chat_conversaciones')
      .select('created_at, updated_at')
      .eq('id', first.conversacionId)
      .single();
    expect(new Date(conv!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(conv!.created_at).getTime(),
    );
  });

  it('3. conversacionId de otro usuario → NOT_FOUND (no appendea)', async () => {
    await signInAs(emailA);
    const { persistChatTurnAction } = await import('@/app/(app)/asistente/actions');
    const own = await persistChatTurnAction({
      conversacionId: null,
      userMessage: 'de A',
      assistantMessage: 'resp A',
    });
    expect(own.ok).toBe(true);
    if (!own.ok) return;

    await signInAs(emailB);
    const { persistChatTurnAction: persistAsB } = await import('@/app/(app)/asistente/actions');
    const res = await persistAsB({
      conversacionId: own.conversacionId,
      userMessage: 'intruso',
      assistantMessage: 'no debería',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('NOT_FOUND');

    // La conversación de A sigue con sus 2 mensajes (no se appendeó nada).
    const { data: msgs } = await admin
      .from('chat_mensajes')
      .select('id')
      .eq('conversacion_id', own.conversacionId);
    expect(msgs?.length).toBe(2);
  });

  it('4. sin sesión → UNAUTHENTICATED', async () => {
    cookieStore.length = 0;
    const { persistChatTurnAction } = await import('@/app/(app)/asistente/actions');
    const res = await persistChatTurnAction({
      conversacionId: null,
      userMessage: 'hola',
      assistantMessage: 'chau',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('UNAUTHENTICATED');
  });

  it('5. INVALID_INPUT: userMessage vacío / assistantMessage > 8000', async () => {
    await signInAs(emailA);
    const { persistChatTurnAction } = await import('@/app/(app)/asistente/actions');

    const empty = await persistChatTurnAction({
      conversacionId: null,
      userMessage: '',
      assistantMessage: 'algo',
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('INVALID_INPUT');

    const tooLong = await persistChatTurnAction({
      conversacionId: null,
      userMessage: 'ok',
      assistantMessage: 'x'.repeat(8001),
    });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.code).toBe('INVALID_INPUT');
  });

  it('6. título = primer mensaje truncado (<= 80 chars)', async () => {
    await signInAs(emailA);
    const { persistChatTurnAction } = await import('@/app/(app)/asistente/actions');
    const longUser = 'A'.repeat(200);
    const res = await persistChatTurnAction({
      conversacionId: null,
      userMessage: longUser,
      assistantMessage: 'resp',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { data: conv } = await admin
      .from('chat_conversaciones')
      .select('titulo')
      .eq('id', res.conversacionId)
      .single();
    expect(conv?.titulo).toBe('A'.repeat(80));
    expect(conv!.titulo.length).toBe(80);
  });
});

describe('archiveChatConversacionAction', () => {
  it('archiva la conversación del usuario (archived_at no null)', async () => {
    await signInAs(emailA);
    const { persistChatTurnAction, archiveChatConversacionAction } =
      await import('@/app/(app)/asistente/actions');
    const created = await persistChatTurnAction({
      conversacionId: null,
      userMessage: 'a archivar',
      assistantMessage: 'ok',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const res = await archiveChatConversacionAction(created.conversacionId);
    expect(res.ok).toBe(true);

    const { data: conv } = await admin
      .from('chat_conversaciones')
      .select('archived_at')
      .eq('id', created.conversacionId)
      .single();
    expect(conv?.archived_at).not.toBeNull();
  });

  it('conversación de otro usuario → NOT_FOUND', async () => {
    await signInAs(emailA);
    const mod = await import('@/app/(app)/asistente/actions');
    const created = await mod.persistChatTurnAction({
      conversacionId: null,
      userMessage: 'de A para archivar',
      assistantMessage: 'ok',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await signInAs(emailB);
    const modB = await import('@/app/(app)/asistente/actions');
    const res = await modB.archiveChatConversacionAction(created.conversacionId);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('NOT_FOUND');
  });
});
