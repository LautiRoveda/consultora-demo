/**
 * T-025 · Tests del route handler POST /api/informes/[id]/generate-stream —
 * auth + permisos.
 *
 * Cubre los gates del endpoint:
 *  1. id malformado (no UUID) → 400 INVALID_INPUT.
 *  2. body invalido (userPrompt > 2000) → 400 INVALID_INPUT.
 *  3. body no-JSON → 400 INVALID_INPUT.
 *  4. sin cookies → 401 UNAUTHENTICATED.
 *  5. user sin consultora → 403 NO_CONSULTORA.
 *  6. informe de OTRA consultora (RLS scope) → 404 NOT_FOUND.
 *  7. member que NO es creator NI owner → 403 FORBIDDEN.
 *
 * Mocks:
 *  - server-only, next/headers, next/cache: stubs estandar (heredados de
 *    informes-content-actions.test.ts).
 *  - @/shared/ai/anthropic: mock de getAnthropicClient(); no se invoca en
 *    ningun test de este file (todos fallan antes del SDK call) pero el
 *    mock previene que TS rompa el route handler en import-time.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
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
}));
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

// Mock del cliente Anthropic. En este archivo ningun test llega a invocar
// .stream() — todos fallan en gates pre-SDK. El mock existe para evitar que
// el import del route handler intente inicializar el SDK con env vars
// faltantes en CI.
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

const slugA = `t025a-ca-${runId}`;
const slugB = `t025a-cb-${runId}`;
const emailOwnerA = `t025a-owner-a-${runId}@example.com`;
const emailMemberA = `t025a-member-a-${runId}@example.com`;
const emailOwnerB = `t025a-owner-b-${runId}@example.com`;
const emailNoConsul = `t025a-noconsul-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let noConsulId: string;
let informeOwnerAInCa: string;
let informeOwnerBInCb: string;

beforeAll(async () => {
  const [{ data: cA }, { data: cB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'T025A cA', slug: slugA }).select('id').single(),
    admin.from('consultoras').insert({ name: 'T025A cB', slug: slugB }).select('id').single(),
  ]);
  cAId = cA!.id;
  cBId = cB!.id;

  const [{ data: uOA }, { data: uMA }, { data: uOB }, { data: uNc }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailMemberA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailNoConsul, password, email_confirm: true }),
  ]);
  ownerAId = uOA.user!.id;
  memberAId = uMA.user!.id;
  ownerBId = uOB.user!.id;
  noConsulId = uNc.user!.id;

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

  const { data: ia } = await admin
    .from('informes')
    .insert({
      consultora_id: cAId,
      tipo: 'rgrl',
      titulo: 'T025A auth: informe ownerA',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  informeOwnerAInCa = ia!.id;

  const { data: ib } = await admin
    .from('informes')
    .insert({
      consultora_id: cBId,
      tipo: 'rgrl',
      titulo: 'T025A auth: informe ownerB',
      created_by: ownerBId,
    })
    .select('id')
    .single();
  informeOwnerBInCb = ib!.id;
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
    admin.auth.admin.deleteUser(noConsulId).catch(() => {}),
  ]);
});

beforeEach(() => {
  cookieStore.length = 0;
  mockMessagesStream.mockReset();
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

function makeReq(id: string, body: unknown): NextRequest {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest(`http://localhost:3000/api/informes/${id}/generate-stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: bodyStr,
  });
}

describe('POST /api/informes/[id]/generate-stream — auth + permisos', () => {
  it('1. id malformado (no UUID) → 400 INVALID_INPUT', async () => {
    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq('not-a-uuid', { userPrompt: '' }), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_INPUT');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('2. body invalido (userPrompt > 2000) → 400 INVALID_INPUT', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeOwnerAInCa, { userPrompt: 'a'.repeat(2001) }), {
      params: Promise.resolve({ id: informeOwnerAInCa }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_INPUT');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('3. body no-JSON → 400 INVALID_INPUT', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeOwnerAInCa, '<<garbage>>'), {
      params: Promise.resolve({ id: informeOwnerAInCa }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_INPUT');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('4. sin cookie de sesion → 401 UNAUTHENTICATED', async () => {
    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeOwnerAInCa, { userPrompt: '' }), {
      params: Promise.resolve({ id: informeOwnerAInCa }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('5. user autenticado SIN consultora → 403 NO_CONSULTORA', async () => {
    await signInAs(emailNoConsul);
    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeOwnerAInCa, { userPrompt: '' }), {
      params: Promise.resolve({ id: informeOwnerAInCa }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NO_CONSULTORA');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('6. informe de OTRA consultora (cross-tenant via RLS) → 404 NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeOwnerBInCb, { userPrompt: '' }), {
      params: Promise.resolve({ id: informeOwnerBInCb }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });

  it('7. member que NO es creator NI owner → 403 FORBIDDEN', async () => {
    // memberA NO es creator del informe (ownerA lo es) ni owner de la consultora.
    await signInAs(emailMemberA);
    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const res = await POST(makeReq(informeOwnerAInCa, { userPrompt: '' }), {
      params: Promise.resolve({ id: informeOwnerAInCa }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');
    expect(mockMessagesStream).not.toHaveBeenCalled();
  });
});
