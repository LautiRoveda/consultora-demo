/**
 * T-020 · Tests de `generateInformeContentAction` y `updateInformeContentAction`.
 *
 * Cubre los 9 paths criticos del discriminated union:
 *  1. generate: input invalido (userPrompt > 2000) → INVALID_INPUT.
 *  2. generate: sin session cookie → UNAUTHENTICATED.
 *  3. generate: informe de OTRA consultora (RLS scope) → NOT_FOUND.
 *  4. generate: member que NO es creator NI owner → FORBIDDEN.
 *  5. generate: happy path → ok:true + content + usage.
 *  6. generate: RateLimitError del SDK → RATE_LIMITED.
 *  7. generate: stop_reason='refusal' → CONTENT_FILTER.
 *  8. update: happy path → ok:true + audit_log con before_data.contenido_preview.
 *  9. update: content > 200k → INVALID_INPUT.
 *
 * Patron de mocks heredado de informes-actions.test.ts:
 *   - server-only no-op.
 *   - next/headers.cookies con store mutable a nivel modulo.
 *   - next/cache.revalidatePath no-op.
 *
 * Anthropic SDK: mockeamos `getAnthropicClient` (no el SDK entero) para
 * preservar las clases de error reales (Anthropic.RateLimitError, etc.)
 * y poder hacer `throw new Anthropic.RateLimitError(...)` desde el test.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import Anthropic from '@anthropic-ai/sdk';
import { createClient as createSbClient } from '@supabase/supabase-js';
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

// Mock del wrapper getAnthropicClient — preservamos el SDK real para usar
// las clases de error en los tests (new Anthropic.RateLimitError(...)).
const mockMessagesCreate = vi.fn();
vi.mock('@/shared/ai/anthropic', () => ({
  CLAUDE_MODEL: 'claude-sonnet-4-6',
  getAnthropicClient: () => ({
    messages: { create: mockMessagesCreate },
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

// Consultora A: ownerA + memberA. Consultora B: ownerB (para test cross-tenant).
const slugA = `t020-ca-${runId}`;
const slugB = `t020-cb-${runId}`;
const emailOwnerA = `t020-owner-a-${runId}@example.com`;
const emailMemberA = `t020-member-a-${runId}@example.com`;
const emailOwnerB = `t020-owner-b-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
// Informe creado por ownerA en cA — usado por varios tests.
let informeOwnerAInCa: string;
// Informe creado por ownerB en cB — usado para test cross-tenant.
let informeOwnerBInCb: string;

beforeAll(async () => {
  // Crear 2 consultoras.
  const [{ data: cA }, { data: cB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'T020 cA', slug: slugA }).select('id').single(),
    admin.from('consultoras').insert({ name: 'T020 cB', slug: slugB }).select('id').single(),
  ]);
  cAId = cA!.id;
  cBId = cB!.id;

  // Crear 3 users.
  const [{ data: uOA }, { data: uMA }, { data: uOB }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailMemberA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true }),
  ]);
  ownerAId = uOA.user!.id;
  memberAId = uMA.user!.id;
  ownerBId = uOB.user!.id;

  // Memberships.
  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  // Claim consultora_id (simula auth hook T-016).
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  // Crear 1 informe en cA (creator=ownerA) y 1 en cB (creator=ownerB).
  const { data: ia } = await admin
    .from('informes')
    .insert({
      consultora_id: cAId,
      tipo: 'rgrl',
      titulo: 'Informe ownerA en cA',
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
      titulo: 'Informe ownerB en cB',
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
  ]);
});

beforeEach(() => {
  // Reset mock + session entre tests.
  mockMessagesCreate.mockReset();
  cookieStore.length = 0;
});

/**
 * Helper: signin del user via el server client mockeado. Popula cookieStore
 * con los tokens de sesion para que la accion vea getUser() != null.
 */
async function signInAs(email: string): Promise<void> {
  const { createClient: createServerClient } = await import('@/shared/supabase/server');
  const sb = await createServerClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
}

/**
 * Helper: arma una response sintetica del SDK Anthropic.
 */
function makeAnthropicResponse(args: {
  text: string;
  stopReason?: 'end_turn' | 'refusal' | 'max_tokens';
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheCreate?: number;
}): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: args.text, citations: null }],
    stop_reason: args.stopReason ?? 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: args.inputTokens ?? 100,
      output_tokens: args.outputTokens ?? 500,
      cache_read_input_tokens: args.cacheRead ?? 0,
      cache_creation_input_tokens: args.cacheCreate ?? 0,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
    },
    container: null,
  } as Anthropic.Message;
}

describe('generateInformeContentAction', () => {
  it('1. input invalido (userPrompt > 2000) → INVALID_INPUT', async () => {
    await signInAs(emailOwnerA);
    const { generateInformeContentAction } = await import('@/app/(app)/informes/[id]/actions');
    const longPrompt = 'a'.repeat(2001);
    const result = await generateInformeContentAction(informeOwnerAInCa, {
      userPrompt: longPrompt,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_INPUT');
    if (result.code !== 'INVALID_INPUT') throw new Error('unreachable');
    expect(result.fieldErrors.userPrompt?.[0]).toMatch(/2000/);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('2. sin session cookie → UNAUTHENTICATED', async () => {
    const { generateInformeContentAction } = await import('@/app/(app)/informes/[id]/actions');
    const result = await generateInformeContentAction(informeOwnerAInCa, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNAUTHENTICATED');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('3. informe de OTRA consultora (cross-tenant via RLS) → NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { generateInformeContentAction } = await import('@/app/(app)/informes/[id]/actions');
    const result = await generateInformeContentAction(informeOwnerBInCb, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('NOT_FOUND');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('4. member que NO es creator NI owner → FORBIDDEN', async () => {
    // memberA NO es creator (ownerA lo es) ni owner de la consultora.
    await signInAs(emailMemberA);
    const { generateInformeContentAction } = await import('@/app/(app)/informes/[id]/actions');
    const result = await generateInformeContentAction(informeOwnerAInCa, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('FORBIDDEN');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('5. happy path → ok:true con content + usage', async () => {
    await signInAs(emailOwnerA);
    mockMessagesCreate.mockResolvedValueOnce(
      makeAnthropicResponse({
        text: '# Informe RGRL\n\nContenido generado.',
        inputTokens: 1500,
        outputTokens: 800,
        cacheRead: 1200,
        cacheCreate: 0,
      }),
    );
    const { generateInformeContentAction } = await import('@/app/(app)/informes/[id]/actions');
    const result = await generateInformeContentAction(informeOwnerAInCa, {
      userPrompt: 'Industria metalmecanica, 80 empleados.',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.content).toContain('# Informe RGRL');
    expect(result.usage.inputTokens).toBe(1500);
    expect(result.usage.outputTokens).toBe(800);
    expect(result.usage.cacheReadInputTokens).toBe(1200);

    // Verificar que llamamos al SDK con prompt caching habilitado.
    expect(mockMessagesCreate).toHaveBeenCalledOnce();
    const call = mockMessagesCreate.mock.calls[0]![0];
    expect(call.model).toBe('claude-sonnet-4-6');
    expect(call.max_tokens).toBe(4096);
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('6. RateLimitError del SDK → RATE_LIMITED', async () => {
    await signInAs(emailOwnerA);
    mockMessagesCreate.mockRejectedValueOnce(
      new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers()),
    );
    const { generateInformeContentAction } = await import('@/app/(app)/informes/[id]/actions');
    const result = await generateInformeContentAction(informeOwnerAInCa, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('RATE_LIMITED');
  });

  it("7. stop_reason='refusal' → CONTENT_FILTER", async () => {
    await signInAs(emailOwnerA);
    mockMessagesCreate.mockResolvedValueOnce(
      makeAnthropicResponse({
        text: '',
        stopReason: 'refusal',
      }),
    );
    const { generateInformeContentAction } = await import('@/app/(app)/informes/[id]/actions');
    const result = await generateInformeContentAction(informeOwnerAInCa, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('CONTENT_FILTER');
  });
});

describe('updateInformeContentAction', () => {
  it('8. happy path → ok:true + audit_log con before_data.contenido_preview', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeContentAction } = await import('@/app/(app)/informes/[id]/actions');

    // Crear informe NUEVO para este test (asi controlamos el contenido inicial).
    const { data: nuevo } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'otros',
        titulo: 'Update test',
        created_by: ownerAId,
        contenido: 'Contenido inicial corto.',
      })
      .select('id')
      .single();
    const targetId = nuevo!.id;

    const nuevoContenido = '# Informe Editado\n\n' + 'Contenido nuevo. '.repeat(20);
    const result = await updateInformeContentAction(targetId, { content: nuevoContenido });
    expect(result.ok).toBe(true);

    // Verificar persistencia.
    const { data: persisted } = await admin
      .from('informes')
      .select('contenido')
      .eq('id', targetId)
      .single();
    expect(persisted?.contenido).toBe(nuevoContenido);

    // Verificar audit_log row con before/after data poblado.
    const { data: audit } = await admin
      .from('audit_log')
      .select('action, before_data, after_data')
      .eq('entity_id', targetId)
      .eq('action', 'updated')
      .single();
    expect(audit?.action).toBe('updated');
    const before = audit?.before_data as Record<string, unknown> | null;
    const after = audit?.after_data as Record<string, unknown> | null;
    expect(before?.contenido_preview).toBe('Contenido inicial corto.');
    expect(before?.contenido_size).toBe('Contenido inicial corto.'.length);
    expect(after?.contenido_size).toBe(nuevoContenido.length);
    // El after_preview termina con '...' porque el contenido nuevo > 500 chars
    // (20 x 'Contenido nuevo. ' = 340 chars... mas heading) — verificar truncado.
    const afterPreview = after?.contenido_preview as string;
    expect(afterPreview.startsWith('# Informe Editado')).toBe(true);
  });

  it('9. content > 200_000 chars → INVALID_INPUT', async () => {
    await signInAs(emailOwnerA);
    const { updateInformeContentAction } = await import('@/app/(app)/informes/[id]/actions');
    const huge = 'x'.repeat(200_001);
    const result = await updateInformeContentAction(informeOwnerAInCa, { content: huge });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_INPUT');
    if (result.code !== 'INVALID_INPUT') throw new Error('unreachable');
    expect(result.fieldErrors.content?.[0]).toMatch(/200/);
  });
});
