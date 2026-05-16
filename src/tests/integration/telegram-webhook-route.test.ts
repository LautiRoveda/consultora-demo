/**
 * T-033 · Tests del route handler POST /api/webhooks/telegram.
 *
 * Cobertura:
 *  1. POST sin header X-Telegram-Bot-Api-Secret-Token → 401.
 *  2. POST con header inválido → 401.
 *  3. POST con body no-JSON → 400.
 *  4. POST con shape de update inválido (Zod fail) → 200 silent (Telegram no
 *     debe reintentar updates malformados).
 *  5. POST sin message → 200 silent.
 *  6. POST sin message.from o sin message.text → 200 silent.
 *  7. `/start <code>` válido → DB UPDATE linked + UPSERT prefs + sendMessage
 *     "✅ Listo!".
 *  8. `/start <code>` expirado → sendMessage "código inválido".
 *  9. `/start <code>` ya consumido (linked_at != null por otra row) →
 *     sendMessage "código inválido".
 * 10. AJUSTE 2 — `/start <code>` desde chat_id ya linkeado → sendMessage
 *     "Ya estás vinculado" + DB sin cambios (linked_at preserved).
 * 11. `/unlink` con sub linkeada → sendMessage "Te desvinculaste" +
 *     DB UPDATE unlinked_at + UPSERT prefs disabled.
 * 12. `/unlink` sin sub linkeada → sendMessage "no te encuentro vinculado".
 * 13. Texto random → sendMessage con instrucción genérica.
 *
 * Mocks:
 *  - server-only: stub.
 *  - @/shared/telegram/bot-client: factory con sendMessage mockeado.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Import del handler AL FINAL para que los mocks aplicen.
import { POST } from '@/app/api/webhooks/telegram/route';
import { env } from '@/env';

vi.mock('server-only', () => ({}));

const mockSendMessage = vi.fn();
vi.mock('@/shared/telegram/bot-client', () => ({
  getTelegramBotClient: () => ({
    sendMessage: mockSendMessage,
    setWebhook: vi.fn(),
    getMe: vi.fn(),
  }),
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `t033-wh-${runId}`;
const emailUser = `t033-wh-user-${runId}@example.com`;
const password = 'TestPassword123!';

let cId: string;
let userId: string;

// Códigos únicos por test (evitar colisión cross-test si beforeEach falla).
function code(suffix: string): string {
  // alfabeto valido [A-Z 2-9], 8 chars exactos para matchear regex del handler
  // → tomamos 8 chars de un hash uppercase basado en runId+suffix.
  const raw = `${runId}${suffix}`.toUpperCase().replace(/[01OI]/g, '2');
  // Filtrar solo chars válidos del alfabeto.
  const alphabet = /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;
  const valid = raw.match(alphabet)?.join('') ?? '';
  const padded = (valid + 'AAAAAAAA').slice(0, 8);
  return padded;
}

function makeRequest(opts: { body: unknown; secret?: string | null }): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.secret !== null) {
    headers['X-Telegram-Bot-Api-Secret-Token'] = opts.secret ?? env.TELEGRAM_WEBHOOK_SECRET;
  }
  return new NextRequest('http://localhost/api/webhooks/telegram', {
    method: 'POST',
    headers,
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
}

function makeUpdate(text: string, chatId: number, username?: string) {
  return {
    update_id: Date.now() + Math.floor(Math.random() * 1000),
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' as const },
      from: { id: chatId, is_bot: false, first_name: 'Test', username },
      text,
    },
  };
}

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T033 WH', slug })
    .select('id')
    .single();
  cId = c!.id;

  const { data: u } = await admin.auth.admin.createUser({
    email: emailUser,
    password,
    email_confirm: true,
  });
  userId = u.user!.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: userId, consultora_id: cId, role: 'owner' });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userId).catch(() => {});
});

beforeEach(async () => {
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue({ ok: true, messageId: 999 });
  // Limpiar telegram_subscriptions de userId + audit_log derivados.
  await admin.from('telegram_subscriptions').delete().eq('user_id', userId);
});

describe('telegram webhook auth', () => {
  it('1. POST sin header X-Telegram-Bot-Api-Secret-Token → 401', async () => {
    const req = makeRequest({ body: makeUpdate('/start XXXXXXXX', 100), secret: null });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('2. POST con header inválido → 401', async () => {
    const req = makeRequest({
      body: makeUpdate('/start XXXXXXXX', 100),
      secret: 'wrong-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('3. POST con body no-JSON → 400', async () => {
    const req = makeRequest({ body: 'not-json-at-all' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('4. Update con shape inválido (sin update_id) → 200 silent', async () => {
    const req = makeRequest({ body: { foo: 'bar' } });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('5. Update sin message (ej callback_query) → 200 silent', async () => {
    const req = makeRequest({ body: { update_id: 123 } });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('6. Update con message sin from.id ni text → 200 silent', async () => {
    const req = makeRequest({
      body: {
        update_id: 456,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1, type: 'private' },
          // sin from, sin text
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe('telegram webhook /start <code>', () => {
  it('7. /start <code> válido → DB linked + UPSERT prefs + "Listo!"', async () => {
    const linkCode = code('07');
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    await admin
      .from('telegram_subscriptions')
      .insert({ user_id: userId, link_code: linkCode, link_code_expires_at: expiresAt });

    const chatId = 1_000_001;
    const req = makeRequest({ body: makeUpdate(`/start ${linkCode}`, chatId, 'lautaroe') });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledOnce();
    const args = mockSendMessage.mock.calls[0]!;
    expect(args[0]).toBe(chatId);
    expect(args[1]).toContain('Listo');

    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('telegram_chat_id, telegram_username, linked_at, link_code, blocked_count')
      .eq('user_id', userId)
      .single();
    expect(sub?.telegram_chat_id).toBe(chatId);
    expect(sub?.telegram_username).toBe('lautaroe');
    expect(sub?.linked_at).toBeTruthy();
    expect(sub?.link_code).toBeNull();
    expect(sub?.blocked_count).toBe(0);

    // Pref telegram debe estar enabled=true.
    const { data: pref } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userId)
      .eq('channel', 'telegram')
      .single();
    expect(pref?.enabled).toBe(true);
  });

  it('8. /start <code> expirado → "código inválido"', async () => {
    const linkCode = code('08');
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await admin
      .from('telegram_subscriptions')
      .insert({ user_id: userId, link_code: linkCode, link_code_expires_at: expiredAt });

    const req = makeRequest({ body: makeUpdate(`/start ${linkCode}`, 1_000_002) });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockSendMessage.mock.calls[0]![1]).toMatch(/inválido|invalido|expirado/i);

    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('linked_at')
      .eq('user_id', userId)
      .single();
    expect(sub?.linked_at).toBeNull();
  });

  it('9. /start <code> ya consumido (no existe link_code activo) → "código inválido"', async () => {
    // Row sin link_code (ya consumido en una vinculación previa).
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    await admin.from('telegram_subscriptions').insert({
      user_id: userId,
      link_code: null,
      link_code_expires_at: expiresAt,
      telegram_chat_id: 555_555,
      linked_at: new Date().toISOString(),
    });

    const req = makeRequest({
      body: makeUpdate(`/start ${code('09')}`, 1_000_003),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockSendMessage.mock.calls[0]![1]).toMatch(/inválido|invalido|expirado/i);
  });

  it('10. AJUSTE 2: /start <code> desde chat_id ya linkeado → "Ya estás vinculado" + DB sin cambios', async () => {
    // Setup: subscription linkeada con chat_id existente.
    const existingChatId = 1_000_010;
    const originalLinkedAt = new Date(Date.now() - 86_400_000).toISOString(); // ayer
    await admin.from('telegram_subscriptions').insert({
      user_id: userId,
      telegram_chat_id: existingChatId,
      telegram_username: 'oldname',
      linked_at: originalLinkedAt,
      link_code: null,
    });

    // Simular retry de Telegram con un código (cualquiera, no debería matchear).
    const req = makeRequest({
      body: makeUpdate(`/start ${code('10')}`, existingChatId, 'newname'),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockSendMessage.mock.calls[0]![1]).toMatch(/Ya estás vinculado|Ya estas vinculado/i);

    // DB intacta: linked_at sigue siendo el original, username NO cambió.
    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('linked_at, telegram_username')
      .eq('user_id', userId)
      .single();
    expect(new Date(sub!.linked_at!).toISOString()).toBe(originalLinkedAt);
    expect(sub?.telegram_username).toBe('oldname');
  });
});

describe('telegram webhook /unlink', () => {
  it('11. /unlink con sub linkeada → "Te desvinculaste" + DB UPDATE + prefs disabled', async () => {
    const chatId = 2_000_011;
    await admin.from('telegram_subscriptions').insert({
      user_id: userId,
      telegram_chat_id: chatId,
      linked_at: new Date().toISOString(),
    });
    // Pre-condición: prefs habilitadas.
    await admin
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userId, channel: 'telegram', enabled: true },
        { onConflict: 'user_id,channel' },
      );

    const req = makeRequest({ body: makeUpdate('/unlink', chatId) });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockSendMessage.mock.calls[0]![1]).toMatch(/desvinculaste/i);

    const { data: sub } = await admin
      .from('telegram_subscriptions')
      .select('unlinked_at, telegram_chat_id')
      .eq('user_id', userId)
      .single();
    expect(sub?.unlinked_at).toBeTruthy();
    expect(sub?.telegram_chat_id).toBeNull();

    const { data: pref } = await admin
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userId)
      .eq('channel', 'telegram')
      .single();
    expect(pref?.enabled).toBe(false);
  });

  it('12. /unlink sin sub linkeada → "no te encuentro"', async () => {
    const req = makeRequest({ body: makeUpdate('/unlink', 2_000_012) });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockSendMessage.mock.calls[0]![1]).toMatch(/no te encuentro/i);
  });
});

describe('telegram webhook texto random', () => {
  it('13. Texto random → instrucción genérica', async () => {
    const req = makeRequest({ body: makeUpdate('hola', 3_000_013) });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockSendMessage.mock.calls[0]![1]).toMatch(/Vinculá tu cuenta|enviando.*\/start/i);
  });
});
