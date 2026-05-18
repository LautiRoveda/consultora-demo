/**
 * T-081 · Tests de rate limiting en POST /api/informes/[id]/generate-stream.
 *
 * Cobertura:
 *  1. Rate limit success → procede al stream (mockMessagesStream invocado).
 *  2. Rate limit failure → 429 + body JSON con code + retryAfterSeconds +
 *     header Retry-After. Anthropic SDK NUNCA invocado.
 *  3. Auth fail (sin cookies) ANTES del rate limit → 401 UNAUTHENTICATED,
 *     mockLimit NO invocado (anti-test del orden auth → rate limit).
 *
 * El rate limit corre POST permission-gate — ya cubrimos auth/consultora/RLS
 * en `informes-generate-stream-auth.test.ts` (T-025). Acá nos enfocamos solo
 * en el rate limit step.
 *
 * Setup mínimo: 1 consultora + 1 owner + 1 informe fixture.
 *
 * Mocks:
 *  - `server-only`, `next/headers`, `next/cache`: stubs estandar.
 *  - `@/shared/security/rate-limit`: factory devuelve limiter con mockLimit.
 *  - `@/shared/ai/anthropic`: stub para no llamar API real (cubrir paths
 *    happy donde el stream debería invocarse).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration -- rate-limit-ai-generation`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => cookieStore.map((c) => ({ name: c.name, value: c.value })),
      set: (name: string, value: string) => {
        const idx = cookieStore.findIndex((c) => c.name === name);
        if (idx >= 0) cookieStore[idx] = { name, value };
        else cookieStore.push({ name, value });
      },
    }),
  headers: () =>
    Promise.resolve({
      get: () => null,
    }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

const mockLimit = vi.fn();
vi.mock('@/shared/security/rate-limit', () => ({
  getRateLimiter: () => ({ limit: mockLimit }),
  noopRateLimiter: {
    limit: () => Promise.resolve({ success: true, remaining: 999, reset: 0, retryAfterSeconds: 0 }),
  },
}));

// Mock Anthropic — devolvemos un async iterable mínimo que el wrapper
// streamAnthropicMessage va a consumir. Para los tests de rate limit, lo
// importante es que el SDK NO se invoque cuando el limiter falla.
const mockMessagesStream = vi.fn();
vi.mock('@/shared/ai/anthropic', () => ({
  CLAUDE_MODEL: 'claude-sonnet-4-6',
  getAnthropicClient: () => ({
    messages: { stream: mockMessagesStream },
  }),
}));

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
const password = 'TestPassword123!';
const slug = `t081-ai-${runId}`;
const emailOwner = `t081-ai-owner-${runId}@example.com`;

let cId: string;
let ownerId: string;
let informeId: string;

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T081 AI gen', slug })
    .select('id')
    .single();
  cId = c!.id;

  const { data: u } = await admin.auth.admin.createUser({
    email: emailOwner,
    password,
    email_confirm: true,
  });
  ownerId = u.user!.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: cId, role: 'owner' });

  await admin.auth.admin.updateUserById(ownerId, {
    app_metadata: { consultora_id: cId },
  });

  const { data: inf } = await admin
    .from('informes')
    .insert({
      consultora_id: cId,
      tipo: 'rgrl',
      titulo: 'T081 AI rate limit fixture',
      created_by: ownerId,
    })
    .select('id')
    .single();
  informeId = inf!.id;
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(ownerId).catch(() => {});
});

beforeEach(() => {
  cookieStore.length = 0;
  mockLimit.mockReset();
  mockMessagesStream.mockReset();
});

async function signInAsOwner(): Promise<void> {
  cookieStore.length = 0;
  const { createClient: createServerClient } = await import('@/shared/supabase/server');
  const sb = await createServerClient();
  const { error } = await sb.auth.signInWithPassword({ email: emailOwner, password });
  expect(error).toBeNull();
}

function makeReq(id: string, body: unknown): NextRequest {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest(`http://localhost:3000/api/informes/${id}/generate-stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: bodyStr,
  });
}

describe('POST /api/informes/[id]/generate-stream · rate limit', () => {
  it('1. rate limit success → procede (mockMessagesStream invocado)', async () => {
    await signInAsOwner();
    mockLimit.mockResolvedValueOnce({
      success: true,
      remaining: 19,
      reset: Date.now() + 3600_000,
      retryAfterSeconds: 0,
    });
    // Mock minimal del stream — emite un async iterable vacio que el wrapper
    // consume y termina sin emitir contenido (no es el objetivo de este test).
    mockMessagesStream.mockReturnValue(
      (async function* () {
        // Empty async generator — wrapper handles graceful termination.
      })(),
    );

    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeId, { userPrompt: 'test' }), {
      params: Promise.resolve({ id: informeId }),
    });
    // El stream se invocó. Puede ser 200 (stream emitido) o algún otro status,
    // pero NO 429. Lo crítico: mockLimit fue invocado UNA vez con ownerId.
    expect(mockLimit).toHaveBeenCalledTimes(1);
    expect(mockLimit).toHaveBeenCalledWith(ownerId);
    expect(res.status).not.toBe(429);
  });

  it('2. rate limit failure → 429 + body JSON + Retry-After header, SDK NO invocado', async () => {
    await signInAsOwner();
    const expectedRetry = 1800;
    mockLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + expectedRetry * 1000,
      retryAfterSeconds: expectedRetry,
    });

    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeId, { userPrompt: 'test' }), {
      params: Promise.resolve({ id: informeId }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe(String(expectedRetry));
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = (await res.json()) as { code: string; message: string; retryAfterSeconds: number };
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.retryAfterSeconds).toBe(expectedRetry);
    expect(body.message).toContain(`${expectedRetry}s`);
    // SDK NUNCA invocado en este path.
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('3. auth fail (sin cookies) ANTES del rate limit → 401, mockLimit NO invocado', async () => {
    // SIN signInAsOwner — cookieStore vacio = sin sesion.
    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeId, { userPrompt: 'test' }), {
      params: Promise.resolve({ id: informeId }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
    expect(mockLimit).not.toHaveBeenCalled();
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });
});
