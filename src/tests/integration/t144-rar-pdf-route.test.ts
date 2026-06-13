/**
 * T-144 · Tests del route handler GET /api/rar/planilla/[clienteId]/pdf.
 *
 * Cubre los gates del endpoint (molde epp-pdf-route.test.ts):
 *  1. clienteId mal formado → 400 INVALID_INPUT.
 *  2. sin cookies → 401 UNAUTHENTICATED.
 *  3. user sin consultora → 403 NO_CONSULTORA.
 *  4. cliente de OTRA consultora → 404 NOT_FOUND.
 *  5. UUID válido inexistente → 404 NOT_FOUND.
 *  6. consultora con trial vencido → 402 BILLING_GATED (gate pre-Puppeteer).
 *  7. happy path (cliente con expuestos) → 200 + application/pdf +
 *     Content-Disposition `planilla-rar-<slug>-<fecha>.pdf` + magic bytes +
 *     x-internal-pdf-render de 64 hex.
 *  8. cliente SIN expuestos → 200 (NO 404 — se genera igual, T-144 D5).
 *  9. PdfRenderTimeoutError → 504 RENDER_TIMEOUT.
 *
 * `@/env` con BILLING_GATE_DISABLED='false' (override: gate ENFORCED, como
 * billing-gate.test.ts). htmlToPdf mockeado + fetch global intercepta el print.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration -- t144-rar-pdf-route`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));

// .env.local de dev tiene BILLING_GATE_DISABLED=true → todos pasarían el gate.
// Override forzado: gate ENFORCED (molde billing-gate.test.ts).
vi.mock('@/env', async () => {
  const actual = await vi.importActual<typeof import('@/env')>('@/env');
  return {
    ...actual,
    env: { ...actual.env, BILLING_GATE_DISABLED: 'false' as const },
  };
});

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null }),
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

// handler usa `after(cb)`; en tests ejecutamos la callback sincronamente.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => {
      void cb();
    },
  };
});

const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4\n%fake rar planilla\n%%EOF\n', 'utf-8');
const mockHtmlToPdf = vi.fn().mockResolvedValue(FAKE_PDF_BUFFER);
vi.mock('@/shared/pdf/render', () => ({
  htmlToPdf: mockHtmlToPdf,
  PdfRenderTimeoutError: class PdfRenderTimeoutError extends Error {
    constructor(stage: string, timeoutMs: number) {
      super(`PDF render timeout en stage "${stage}" (${timeoutMs} ms)`);
      this.name = 'PdfRenderTimeoutError';
    }
  },
}));

const originalFetch = global.fetch;
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const urlStr =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (urlStr.includes('/rar/planilla/') && urlStr.endsWith('/print')) {
    return Promise.resolve(
      new Response('<html><body>fake rar print page</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
  }
  return originalFetch(input, init);
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';
const slugA = `t144r-a-${runId}`;
const slugB = `t144r-b-${runId}`;
const slugC = `t144r-c-${runId}`;
const emailOwnerA = `t144r-own-a-${runId}@example.com`;
const emailOwnerB = `t144r-own-b-${runId}@example.com`;
const emailOwnerC = `t144r-own-c-${runId}@example.com`;
const emailNoConsul = `t144r-noconsul-${runId}@example.com`;

let cAId: string;
let cBId: string;
let cCId: string;
let ownerAId: string;
let ownerBId: string;
let ownerCId: string;
let noConsulId: string;
let clienteAId: string; // con expuestos
let clienteAsinExpId: string; // sin empleados
let clienteBId: string; // consultora B
let clienteCId: string; // consultora C (trial vencido)

beforeAll(async () => {
  const trialFuture = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const trialPast = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  cAId = (
    await admin
      .from('consultoras')
      .insert({ name: 'T144R A', slug: slugA, plan: 'trial', trial_hasta: trialFuture })
      .select('id')
      .single()
  ).data!.id;
  cBId = (
    await admin
      .from('consultoras')
      .insert({ name: 'T144R B', slug: slugB, plan: 'trial', trial_hasta: trialFuture })
      .select('id')
      .single()
  ).data!.id;
  cCId = (
    await admin
      .from('consultoras')
      .insert({ name: 'T144R C', slug: slugC, plan: 'trial', trial_hasta: trialPast })
      .select('id')
      .single()
  ).data!.id;

  ownerAId = (
    await admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true })
  ).data.user!.id;
  ownerBId = (
    await admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true })
  ).data.user!.id;
  ownerCId = (
    await admin.auth.admin.createUser({ email: emailOwnerC, password, email_confirm: true })
  ).data.user!.id;
  noConsulId = (
    await admin.auth.admin.createUser({ email: emailNoConsul, password, email_confirm: true })
  ).data.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
    { user_id: ownerCId, consultora_id: cCId, role: 'owner' },
  ]);
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, {
      app_metadata: { consultora_id: cAId, consultora_role: 'owner' },
    }),
    admin.auth.admin.updateUserById(ownerBId, {
      app_metadata: { consultora_id: cBId, consultora_role: 'owner' },
    }),
    admin.auth.admin.updateUserById(ownerCId, {
      app_metadata: { consultora_id: cCId, consultora_role: 'owner' },
    }),
  ]);

  const cuitBase = Date.now().toString().slice(-8).padStart(8, '0');
  clienteAId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Metalurgica T144R ${runId}`,
        cuit: `30-${cuitBase}-1`,
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  clienteAsinExpId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Sin Expuestos T144R ${runId}`,
        cuit: `30-${cuitBase}-2`,
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  clienteBId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cBId,
        razon_social: `Cliente B T144R ${runId}`,
        cuit: `30-${cuitBase}-3`,
        created_by: ownerBId,
      })
      .select('id')
      .single()
  ).data!.id;
  clienteCId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cCId,
        razon_social: `Cliente C T144R ${runId}`,
        cuit: `30-${cuitBase}-4`,
        created_by: ownerCId,
      })
      .select('id')
      .single()
  ).data!.id;

  // Cadena de exposición mínima en clienteA: 1 agente, 1 puesto, 1 empleado.
  const agId = (
    await admin
      .from('rar_agentes')
      .insert({
        consultora_id: cAId,
        codigo: `RA-${runId}`,
        nombre: 'Ruido',
        agente_tipo: 'fisico',
      })
      .select('id')
      .single()
  ).data!.id;
  const puestoId = (
    await admin
      .from('puestos')
      .insert({ consultora_id: cAId, nombre: `Soldador ${runId}` })
      .select('id')
      .single()
  ).data!.id;
  await admin
    .from('cliente_puesto_agentes')
    .insert({ cliente_id: clienteAId, puesto_id: puestoId, agente_id: agId, consultora_id: cAId });
  const empId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Ana',
        apellido: 'Lopez',
        dni: '20555666',
        cuil: '27-20555666-4',
        fecha_ingreso: '2021-01-10',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  await admin
    .from('empleados_puestos')
    .insert({ empleado_id: empId, puesto_id: puestoId, consultora_id: cAId });
});

afterAll(async () => {
  for (const c of [cAId, cBId, cCId]) {
    await admin
      .from('empleados_puestos')
      .delete()
      .eq('consultora_id', c)
      .then(() => {});
    await admin
      .from('cliente_puesto_agentes')
      .delete()
      .eq('consultora_id', c)
      .then(() => {});
    await admin
      .from('empleados')
      .delete()
      .eq('consultora_id', c)
      .then(() => {});
    await admin
      .from('rar_agentes')
      .delete()
      .eq('consultora_id', c)
      .then(() => {});
    await admin
      .from('puestos')
      .delete()
      .eq('consultora_id', c)
      .then(() => {});
    await admin
      .from('clientes')
      .delete()
      .eq('consultora_id', c)
      .then(() => {});
    await admin
      .from('consultora_members')
      .delete()
      .eq('consultora_id', c)
      .then(() => {});
  }
  await admin
    .from('consultoras')
    .delete()
    .in('id', [cAId, cBId, cCId])
    .then(() => {});
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerCId).catch(() => {});
  await admin.auth.admin.deleteUser(noConsulId).catch(() => {});
  global.fetch = originalFetch;
});

beforeEach(() => {
  cookieStore.length = 0;
  fetchMock.mockClear();
  global.fetch = fetchMock;
  mockHtmlToPdf.mockResolvedValue(FAKE_PDF_BUFFER);
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

function makeReq(clienteId: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/rar/planilla/${clienteId}/pdf`, {
    method: 'GET',
    headers: { 'user-agent': 'vitest', 'x-forwarded-for': '127.0.0.1' },
  });
}

describe('GET /api/rar/planilla/[clienteId]/pdf', () => {
  it('1. clienteId malformado → 400 INVALID_INPUT', async () => {
    const { GET } = await import('@/app/api/rar/planilla/[clienteId]/pdf/route');
    const res = await GET(makeReq('not-a-uuid'), {
      params: Promise.resolve({ clienteId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('2. sin cookie de sesión → 401 UNAUTHENTICATED', async () => {
    const { GET } = await import('@/app/api/rar/planilla/[clienteId]/pdf/route');
    const res = await GET(makeReq(clienteAId), {
      params: Promise.resolve({ clienteId: clienteAId }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('3. user autenticado SIN consultora → 403 NO_CONSULTORA', async () => {
    await signInAs(emailNoConsul);
    const { GET } = await import('@/app/api/rar/planilla/[clienteId]/pdf/route');
    const res = await GET(makeReq(clienteAId), {
      params: Promise.resolve({ clienteId: clienteAId }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('NO_CONSULTORA');
  });

  it('4. cliente de OTRA consultora → 404 NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/rar/planilla/[clienteId]/pdf/route');
    const res = await GET(makeReq(clienteBId), {
      params: Promise.resolve({ clienteId: clienteBId }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('5. UUID válido inexistente → 404 NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/rar/planilla/[clienteId]/pdf/route');
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const res = await GET(makeReq(fakeUuid), { params: Promise.resolve({ clienteId: fakeUuid }) });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('6. consultora con trial vencido → 402 BILLING_GATED', async () => {
    await signInAs(emailOwnerC);
    const { GET } = await import('@/app/api/rar/planilla/[clienteId]/pdf/route');
    const res = await GET(makeReq(clienteCId), {
      params: Promise.resolve({ clienteId: clienteCId }),
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { code: string }).code).toBe('BILLING_GATED');
  });

  it('7. happy path (con expuestos) → 200 + application/pdf + headers + magic bytes', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/rar/planilla/[clienteId]/pdf/route');
    const res = await GET(makeReq(clienteAId), {
      params: Promise.resolve({ clienteId: clienteAId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');

    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/attachment;/);
    expect(cd).toMatch(/filename="planilla-rar-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.pdf"/);
    expect(cd).toMatch(/filename\*=UTF-8''/);

    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');

    const printCalls = fetchMock.mock.calls.filter(([input]) => {
      const u =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return u.includes('/rar/planilla/') && u.endsWith('/print');
    });
    expect(printCalls).toHaveLength(1);
    const headers = printCalls[0]![1]?.headers as Record<string, string>;
    expect(headers['x-internal-pdf-render']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('8. cliente SIN expuestos → 200 (no 404, se genera igual)', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/rar/planilla/[clienteId]/pdf/route');
    const res = await GET(makeReq(clienteAsinExpId), {
      params: Promise.resolve({ clienteId: clienteAsinExpId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('9. PdfRenderTimeoutError de htmlToPdf → 504 RENDER_TIMEOUT', async () => {
    await signInAs(emailOwnerA);
    const { PdfRenderTimeoutError } = await import('@/shared/pdf/render');
    mockHtmlToPdf.mockRejectedValueOnce(new PdfRenderTimeoutError('pdf', 15000));
    const { GET } = await import('@/app/api/rar/planilla/[clienteId]/pdf/route');
    const res = await GET(makeReq(clienteAId), {
      params: Promise.resolve({ clienteId: clienteAId }),
    });
    expect(res.status).toBe(504);
    expect(((await res.json()) as { code: string }).code).toBe('RENDER_TIMEOUT');
  });
});
