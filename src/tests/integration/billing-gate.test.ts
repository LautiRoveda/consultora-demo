/**
 * T-073 · Integration tests del trial gate enforcement.
 *
 * Cobertura:
 *  1. createClienteAction con consultora trial vencido → BILLING_GATED/TRIAL_EXPIRED.
 *  2. createClienteAction con consultora trial vigente → ok.
 *  3. createEmpleadoAction con trial vencido → BILLING_GATED.
 *  4. createInformeAction con trial vencido → BILLING_GATED.
 *  5. createCalendarEventAction con trial vencido → BILLING_GATED.
 *  6. createClienteAction con suscripción cancelada + cancelar_en pasado →
 *     BILLING_GATED/SUBSCRIPTION_CANCELLED.
 *  7. API route GET /api/informes/[id]/pdf con trial vencido → 402 BILLING_GATED.
 *  8. API route POST /api/informes/[id]/generate-stream con trial vencido →
 *     402 BILLING_GATED.
 *
 * Setup SECUENCIAL (lesson T-047). Fechas hardcoded de trial_hasta para
 * evitar timing flakiness.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));

// .env.local de Lautaro tiene `BILLING_GATE_DISABLED=true` para dev — esto
// haría que TODOS estos tests pasaran sin tocar el gate. Override forzado:
// gate ENFORCED. El test de bypass (describe separado abajo) hace doMock.
vi.mock('@/env', async () => {
  const actual = await vi.importActual<typeof import('@/env')>('@/env');
  return {
    ...actual,
    env: { ...actual.env, BILLING_GATE_DISABLED: 'false' as const },
  };
});

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

// Mock del Anthropic client — el PDF y generate-stream gates corren antes de
// invocar cualquier IA real, pero el import de los route handlers necesita
// el SDK inicializable.
vi.mock('@/shared/ai/anthropic', () => ({
  CLAUDE_MODEL: 'claude-sonnet-4-6',
  getAnthropicClient: () => ({ messages: { stream: vi.fn() } }),
}));

// Mock de la pool de Puppeteer para el PDF route — el gate corta antes pero
// el módulo se importa.
vi.mock('@/shared/pdf/render', () => ({
  htmlToPdf: vi.fn(),
  PdfRenderTimeoutError: class extends Error {},
}));
vi.mock('@/shared/pdf/browser-pool', () => ({
  getInternalPdfRenderToken: () => 'test-token',
}));

const loggerMock = vi.fn();
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: () => {},
    debug: () => {},
    info: (arg: unknown, msg?: string) => loggerMock(arg, msg),
    warn: (arg: unknown, msg?: string) => loggerMock(arg, msg),
    error: (arg: unknown, msg?: string) => loggerMock(arg, msg),
    fatal: () => {},
  },
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

const slugGated = `t073g-${runId}`;
const slugActive = `t073a-${runId}`;
const slugCancelled = `t073c-${runId}`;
const emailGated = `t073-gated-${runId}@example.com`;
const emailActive = `t073-active-${runId}@example.com`;
const emailCancelled = `t073-cancelled-${runId}@example.com`;

let cGatedId: string;
let cActiveId: string;
let cCancelledId: string;
let userGatedId: string;
let userActiveId: string;
let userCancelledId: string;
let clienteInGatedId: string;
let informeInGatedId: string;

// Helper: CUITs únicos formato `XX-XXXXXXXX-X` (mismo patrón que
// clientes-actions.test.ts). El SQL check valida el formato pre-normalize.
let cuitCounter = 80_000_000;
function nextCuit(): string {
  cuitCounter += 1;
  const middle = cuitCounter.toString().padStart(8, '0');
  return `30-${middle}-9`;
}

beforeAll(async () => {
  // Setup SECUENCIAL (lesson T-047 sa-east-1 flaky).
  const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString();

  // Consultora GATED: trial vencido ayer, sin sub.
  const { data: cG, error: errG } = await admin
    .from('consultoras')
    .insert({ name: 'T073 gated', slug: slugGated, plan: 'trial', trial_hasta: yesterdayIso })
    .select('id')
    .single();
  if (errG) throw errG;
  cGatedId = cG.id;

  // Consultora ACTIVE: plan pro + sub activa.
  const { data: cA, error: errA } = await admin
    .from('consultoras')
    .insert({ name: 'T073 active', slug: slugActive, plan: 'pro', trial_hasta: null })
    .select('id')
    .single();
  if (errA) throw errA;
  cActiveId = cA.id;

  // Consultora CANCELLED: sub cancelada con cancelar_en pasado.
  const { data: cC, error: errC } = await admin
    .from('consultoras')
    .insert({ name: 'T073 cancelled', slug: slugCancelled, plan: 'pro', trial_hasta: null })
    .select('id')
    .single();
  if (errC) throw errC;
  cCancelledId = cC.id;

  const { data: uG } = await admin.auth.admin.createUser({
    email: emailGated,
    password,
    email_confirm: true,
  });
  userGatedId = uG.user!.id;
  const { data: uA } = await admin.auth.admin.createUser({
    email: emailActive,
    password,
    email_confirm: true,
  });
  userActiveId = uA.user!.id;
  const { data: uC } = await admin.auth.admin.createUser({
    email: emailCancelled,
    password,
    email_confirm: true,
  });
  userCancelledId = uC.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: userGatedId, consultora_id: cGatedId, role: 'owner' },
    { user_id: userActiveId, consultora_id: cActiveId, role: 'owner' },
    { user_id: userCancelledId, consultora_id: cCancelledId, role: 'owner' },
  ]);

  await admin.auth.admin.updateUserById(userGatedId, {
    app_metadata: { consultora_id: cGatedId },
  });
  await admin.auth.admin.updateUserById(userActiveId, {
    app_metadata: { consultora_id: cActiveId },
  });
  await admin.auth.admin.updateUserById(userCancelledId, {
    app_metadata: { consultora_id: cCancelledId },
  });

  // Sub activa para la consultora ACTIVE.
  await admin.from('suscripciones').insert({
    consultora_id: cActiveId,
    plan_codigo: 'pro_mensual',
    estado: 'activa',
    mp_subscription_id: `mp-t073-active-${runId}`,
    periodo_inicio: yesterdayIso,
    periodo_fin: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });

  // Sub cancelada con cancelar_en pasado para CANCELLED.
  await admin.from('suscripciones').insert({
    consultora_id: cCancelledId,
    plan_codigo: 'pro_mensual',
    estado: 'cancelada',
    mp_subscription_id: `mp-t073-cancelled-${runId}`,
    periodo_inicio: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    periodo_fin: yesterdayIso,
    cancelar_en: yesterdayIso,
    cancelada_en: new Date(Date.now() - 7 * 86_400_000).toISOString(),
  });

  // Cliente fixture en la consultora GATED (creado via service-role, bypasea
  // el gate — necesitamos un cliente_id para el test de empleado, que falla
  // por gate ANTES del cross-tenant check).
  const { data: cli, error: errCli } = await admin
    .from('clientes')
    .insert({
      consultora_id: cGatedId,
      razon_social: `T073 cliente fixture ${runId}`,
      cuit: nextCuit(),
      created_by: userGatedId,
    })
    .select('id')
    .single();
  if (errCli) throw errCli;
  clienteInGatedId = cli.id;

  // Informe fixture en GATED (para el test de PDF/generate-stream, que
  // necesitan un informe existente; el gate dispara antes del fetch).
  const { data: inf, error: errInf } = await admin
    .from('informes')
    .insert({
      consultora_id: cGatedId,
      tipo: 'rgrl',
      titulo: 'T073 informe fixture',
      created_by: userGatedId,
      contenido: 'contenido de prueba',
    })
    .select('id')
    .single();
  if (errInf) throw errInf;
  informeInGatedId = inf.id;
});

afterAll(async () => {
  await admin.from('informes').delete().eq('consultora_id', cGatedId);
  await admin.from('clientes').delete().eq('consultora_id', cGatedId);
  await admin.from('suscripciones').delete().eq('consultora_id', cActiveId);
  await admin.from('suscripciones').delete().eq('consultora_id', cCancelledId);
  await admin.auth.admin.deleteUser(userGatedId).catch(() => {});
  await admin.auth.admin.deleteUser(userActiveId).catch(() => {});
  await admin.auth.admin.deleteUser(userCancelledId).catch(() => {});
});

beforeEach(() => {
  cookieStore.length = 0;
  loggerMock.mockClear();
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

describe('T-073 · Trial gate en server actions de CREATE', () => {
  it('1. createClienteAction con trial vencido → BILLING_GATED/TRIAL_EXPIRED', async () => {
    await signInAs(emailGated);
    const { createClienteAction } = await import('@/app/(app)/clientes/actions');
    const result = await createClienteAction({
      razon_social: `Test gated ${runId}`,
      cuit: nextCuit(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BILLING_GATED');
    if (result.code !== 'BILLING_GATED') return;
    expect(result.reason).toBe('TRIAL_EXPIRED');
    expect(result.message).toContain('trial venció');
  });

  it('2. createClienteAction con sub activa → ok', async () => {
    await signInAs(emailActive);
    const { createClienteAction } = await import('@/app/(app)/clientes/actions');
    const result = await createClienteAction({
      razon_social: `Test active ${runId}`,
      cuit: nextCuit(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Cleanup
    await admin.from('clientes').delete().eq('id', result.clienteId);
  });

  it('3. createEmpleadoAction con trial vencido → BILLING_GATED', async () => {
    await signInAs(emailGated);
    const { createEmpleadoAction } = await import('@/app/(app)/empleados/actions');
    const result = await createEmpleadoAction({
      cliente_id: clienteInGatedId,
      nombre: 'Test',
      apellido: 'Gated',
      dni: '11111111',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BILLING_GATED');
  });

  it('4. createInformeAction con trial vencido → BILLING_GATED', async () => {
    await signInAs(emailGated);
    const { createInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await createInformeAction({
      tipo: 'rgrl',
      titulo: `Test gated ${runId}`,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BILLING_GATED');
  });

  it('5. createCalendarEventAction con trial vencido → BILLING_GATED', async () => {
    await signInAs(emailGated);
    const { createCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await createCalendarEventAction({
      tipo: 'rgrl_anual',
      titulo: `Test gated ${runId}`,
      fecha_vencimiento: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BILLING_GATED');
  });

  it('6. createClienteAction con sub cancelada + cancelar_en pasado → BILLING_GATED/SUBSCRIPTION_CANCELLED', async () => {
    await signInAs(emailCancelled);
    const { createClienteAction } = await import('@/app/(app)/clientes/actions');
    const result = await createClienteAction({
      razon_social: `Test cancelled ${runId}`,
      cuit: nextCuit(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BILLING_GATED');
    if (result.code !== 'BILLING_GATED') return;
    expect(result.reason).toBe('SUBSCRIPTION_CANCELLED');
  });
});

describe('T-073 · Trial gate en API routes', () => {
  it('7. GET /api/informes/[id]/pdf con trial vencido → 402 BILLING_GATED', async () => {
    await signInAs(emailGated);
    const { GET } = await import('@/app/api/informes/[id]/pdf/route');
    const req = new NextRequest(`http://localhost:3000/api/informes/${informeInGatedId}/pdf`, {
      method: 'GET',
      headers: { 'user-agent': 'vitest' },
    });
    const res = await GET(req, { params: Promise.resolve({ id: informeInGatedId }) });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { code: string; reason: string };
    expect(body.code).toBe('BILLING_GATED');
    expect(body.reason).toBe('TRIAL_EXPIRED');
  });

  it('8. POST /api/informes/[id]/generate-stream con trial vencido → 402 BILLING_GATED', async () => {
    await signInAs(emailGated);
    const { POST } = await import('@/app/api/informes/[id]/generate-stream/route');
    const req = new NextRequest(
      `http://localhost:3000/api/informes/${informeInGatedId}/generate-stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
        body: JSON.stringify({ userPrompt: 'test' }),
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: informeInGatedId }) });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { code: string; reason: string };
    expect(body.code).toBe('BILLING_GATED');
    expect(body.reason).toBe('TRIAL_EXPIRED');
  });
});
