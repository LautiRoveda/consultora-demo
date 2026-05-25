/**
 * C1 audit · Tests del rate limit en POST /api/webhooks/telegram.
 *
 * Cobertura:
 *  1. Rate limit success → procede al handler normal (sendMessage llamado).
 *  2. Rate limit failure (silent ack) → 200 ok:true PERO sendMessage NO se
 *     invoca. Verifica que devolvemos 200 silent (NO 429) para que Telegram
 *     no reintente con backoff exponencial.
 *  3. Key isolation: distintos `from.id` no comparten bucket. Mockeamos que
 *     el limiter rechaza SOLO un chatId específico — otro pasa.
 *
 * Mocks:
 *  - server-only: stub.
 *  - @/shared/security/rate-limit: factory devuelve limiter con mockLimit
 *    configurable. Mockeamos NUESTRO helper, no `@upstash/ratelimit`.
 *  - @/shared/telegram/bot-client: sendMessage spy.
 *
 * Pre-test: requiere supabase local (handler hace queries reales contra
 * telegram_subscriptions). Setup mínimo de consultora + user al inicio.
 *
 * Correr: `set -a && source .env.local && set +a && pnpm test:integration -- telegram-webhook-rate-limit`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockLimit = vi.fn();
vi.mock('@/shared/security/rate-limit', () => ({
  getRateLimiter: () => ({ limit: mockLimit }),
  noopRateLimiter: {
    limit: () => Promise.resolve({ success: true, remaining: 999, reset: 0, retryAfterSeconds: 0 }),
  },
}));

const mockSendMessage = vi.fn();
vi.mock('@/shared/telegram/bot-client', () => ({
  getTelegramBotClient: () => ({
    sendMessage: mockSendMessage,
    setWebhook: vi.fn(),
    getMe: vi.fn(),
  }),
}));

// Import del handler AL FINAL para que los mocks aplicen.
const { POST } = await import('@/app/api/webhooks/telegram/route');
const { env } = await import('@/env');

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
const slug = `c1-rl-tg-${runId}`;
const emailUser = `c1-rl-tg-${runId}@example.com`;

let cId: string;
let userId: string;

function makeRequest(body: unknown, secret = env.TELEGRAM_WEBHOOK_SECRET): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/telegram', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': secret,
    },
    body: JSON.stringify(body),
  });
}

function makeUpdate(text: string, chatId: number) {
  return {
    update_id: Date.now() + Math.floor(Math.random() * 100000),
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' as const },
      from: { id: chatId, is_bot: false, first_name: 'Test' },
      text,
    },
  };
}

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'C1 RL TG', slug })
    .select('id')
    .single();
  cId = c!.id;
  const { data: u } = await admin.auth.admin.createUser({
    email: emailUser,
    password: 'TestPassword123!',
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
  mockLimit.mockReset();
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue({ ok: true, messageId: 1 });
  await admin.from('telegram_subscriptions').delete().eq('user_id', userId);
});

describe('telegram webhook · rate limit (C1)', () => {
  it('1. rate limit success → handler procede (sendMessage invocado para texto genérico)', async () => {
    mockLimit.mockResolvedValueOnce({
      success: true,
      remaining: 119,
      reset: Date.now() + 60_000,
      retryAfterSeconds: 0,
    });

    const chatId = 5_000_001;
    const req = makeRequest(makeUpdate('hola', chatId));
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockLimit).toHaveBeenCalledTimes(1);
    expect(mockLimit).toHaveBeenCalledWith(String(chatId));
    // Texto random → sendMessage con instrucción genérica.
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it('2. rate limit failure → 200 silent ack, sendMessage NO invocado', async () => {
    mockLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 30_000,
      retryAfterSeconds: 30,
    });

    const chatId = 5_000_002;
    const req = makeRequest(makeUpdate('/start ABCDEF22', chatId));
    const res = await POST(req);

    // Silent ack: 200 + ok:true. NO 429 — evita que Telegram reintente.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    // Crítico: NO se ejecuta nada del handler post rate-limit.
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledOnce();
    expect(mockLimit).toHaveBeenCalledWith(String(chatId));
  });

  it('3. distintos from.id → key isolation, no comparten bucket', async () => {
    // El limiter es un singleton mock; simulamos: chat A rechazado, chat B OK.
    mockLimit
      .mockResolvedValueOnce({
        success: false,
        remaining: 0,
        reset: Date.now() + 30_000,
        retryAfterSeconds: 30,
      })
      .mockResolvedValueOnce({
        success: true,
        remaining: 50,
        reset: Date.now() + 60_000,
        retryAfterSeconds: 0,
      });

    const chatA = 5_000_010;
    const chatB = 5_000_011;
    const resA = await POST(makeRequest(makeUpdate('hola A', chatA)));
    const resB = await POST(makeRequest(makeUpdate('hola B', chatB)));

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(mockLimit).toHaveBeenCalledTimes(2);
    expect(mockLimit).toHaveBeenNthCalledWith(1, String(chatA));
    expect(mockLimit).toHaveBeenNthCalledWith(2, String(chatB));
    // Chat A: rate-limited → sendMessage NO.
    // Chat B: success → sendMessage SÍ (texto random "hola B").
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });
});
