/**
 * T-147 · Tests del route handler GET /api/rar/presentaciones/[presentacionId]/pdf
 * (descarga histórica de la planilla RAR desde el snapshot de rar_presentaciones).
 *
 * Cubre los gates del endpoint (molde t144-rar-pdf-route.test.ts):
 *  1. presentacionId mal formado → 400 INVALID_INPUT.
 *  2. sin cookies → 401 UNAUTHENTICATED.
 *  3. user sin consultora → 403 NO_CONSULTORA.
 *  4. presentación de OTRA consultora → 404 NOT_FOUND (cross-tenant).
 *  5. UUID válido inexistente → 404 NOT_FOUND.
 *  6. consultora con trial vencido → 402 BILLING_GATED (gate pre-Puppeteer).
 *  7. happy path → 200 + application/pdf + Content-Disposition
 *     `planilla-rar-<slug>-<periodo>.pdf` (período, no fecha) + magic bytes +
 *     x-internal-pdf-render de 64 hex (apuntando al print histórico).
 *  8. PdfRenderTimeoutError → 504 RENDER_TIMEOUT.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration -- t147-rar-historica`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));

// Override forzado: gate ENFORCED (molde billing-gate.test.ts / t144).
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

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => {
      void cb();
    },
  };
});

const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4\n%fake rar historica\n%%EOF\n', 'utf-8');
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
  if (urlStr.includes('/rar/presentaciones/') && urlStr.endsWith('/print')) {
    return Promise.resolve(
      new Response('<html><body>fake rar historica print page</body></html>', {
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
const slugA = `t147-a-${runId}`;
const slugB = `t147-b-${runId}`;
const slugC = `t147-c-${runId}`;
const emailOwnerA = `t147-own-a-${runId}@example.com`;
const emailOwnerB = `t147-own-b-${runId}@example.com`;
const emailOwnerC = `t147-own-c-${runId}@example.com`;
const emailNoConsul = `t147-noconsul-${runId}@example.com`;

const PERIODO = 2025;

let cAId: string;
let cBId: string;
let cCId: string;
let ownerAId: string;
let ownerBId: string;
let ownerCId: string;
let noConsulId: string;
let clienteAId: string;
let clienteBId: string;
let clienteCId: string;
let presentacionAId: string;
let presentacionBId: string;
let presentacionCId: string;

function snapshotFor(
  razonSocial: string,
): Database['public']['Tables']['rar_presentaciones']['Insert']['snapshot'] {
  return {
    cliente: {
      id: '00000000-0000-0000-0000-000000000000',
      razon_social: razonSocial,
      cuit: '30-12345678-9',
      art: 'Prevención ART',
      domicilio: 'Calle Falsa 123',
      localidad: 'Córdoba',
      provincia: 'Córdoba',
    },
    nomina: {
      expuestos: [
        {
          empleado_id: '11111111-1111-1111-1111-111111111111',
          apellido: 'Lopez',
          nombre: 'Ana',
          cuil: '27-20555666-4',
          dni: '20555666',
          fecha_ingreso: '2021-01-10',
          puestos: ['Soldador'],
          agentes: [
            {
              agente_id: '22222222-2222-2222-2222-222222222222',
              codigo: 'RA-1',
              nombre: 'Ruido',
              agente_tipo: 'fisico',
            },
          ],
          faltan_datos: false,
        },
      ],
      agentes: [
        {
          agente_id: '22222222-2222-2222-2222-222222222222',
          codigo: 'RA-1',
          nombre: 'Ruido',
          agente_tipo: 'fisico',
        },
      ],
    },
    fecha_presentacion: '2025-03-15',
    fecha_vencimiento: '2026-03-15',
    periodo: PERIODO,
    generado_at: '2025-03-15T12:00:00.000Z',
  };
}

async function insCliente(consultoraId: string, createdBy: string, razon: string): Promise<string> {
  const cuit = `30-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 9)}`;
  const { data, error } = await admin
    .from('clientes')
    .insert({ consultora_id: consultoraId, razon_social: razon, cuit, created_by: createdBy })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function insPresentacion(
  consultoraId: string,
  clienteId: string,
  createdBy: string,
  razon: string,
): Promise<string> {
  const { data, error } = await admin
    .from('rar_presentaciones')
    .insert({
      consultora_id: consultoraId,
      cliente_id: clienteId,
      periodo: PERIODO,
      fecha_presentacion: '2025-03-15',
      fecha_vencimiento: '2026-03-15',
      snapshot: snapshotFor(razon),
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

beforeAll(async () => {
  const trialFuture = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const trialPast = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  cAId = (
    await admin
      .from('consultoras')
      .insert({ name: 'T147 A', slug: slugA, plan: 'trial', trial_hasta: trialFuture })
      .select('id')
      .single()
  ).data!.id;
  cBId = (
    await admin
      .from('consultoras')
      .insert({ name: 'T147 B', slug: slugB, plan: 'trial', trial_hasta: trialFuture })
      .select('id')
      .single()
  ).data!.id;
  cCId = (
    await admin
      .from('consultoras')
      .insert({ name: 'T147 C', slug: slugC, plan: 'trial', trial_hasta: trialPast })
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

  clienteAId = await insCliente(cAId, ownerAId, `Metalurgica T147 ${runId}`);
  clienteBId = await insCliente(cBId, ownerBId, `Cliente B T147 ${runId}`);
  clienteCId = await insCliente(cCId, ownerCId, `Cliente C T147 ${runId}`);

  presentacionAId = await insPresentacion(cAId, clienteAId, ownerAId, `Metalurgica T147 ${runId}`);
  presentacionBId = await insPresentacion(cBId, clienteBId, ownerBId, `Cliente B T147 ${runId}`);
  presentacionCId = await insPresentacion(cCId, clienteCId, ownerCId, `Cliente C T147 ${runId}`);
});

afterAll(async () => {
  for (const c of [cAId, cBId, cCId]) {
    await admin
      .from('rar_presentaciones')
      .delete()
      .eq('consultora_id', c)
      .then(() => {});
    await admin
      .from('calendar_events')
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

function makeReq(presentacionId: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/rar/presentaciones/${presentacionId}/pdf`, {
    method: 'GET',
    headers: { 'user-agent': 'vitest', 'x-forwarded-for': '127.0.0.1' },
  });
}

describe('GET /api/rar/presentaciones/[presentacionId]/pdf', () => {
  it('1. presentacionId malformado → 400 INVALID_INPUT', async () => {
    const { GET } = await import('@/app/api/rar/presentaciones/[presentacionId]/pdf/route');
    const res = await GET(makeReq('not-a-uuid'), {
      params: Promise.resolve({ presentacionId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('2. sin cookie de sesión → 401 UNAUTHENTICATED', async () => {
    const { GET } = await import('@/app/api/rar/presentaciones/[presentacionId]/pdf/route');
    const res = await GET(makeReq(presentacionAId), {
      params: Promise.resolve({ presentacionId: presentacionAId }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('3. user autenticado SIN consultora → 403 NO_CONSULTORA', async () => {
    await signInAs(emailNoConsul);
    const { GET } = await import('@/app/api/rar/presentaciones/[presentacionId]/pdf/route');
    const res = await GET(makeReq(presentacionAId), {
      params: Promise.resolve({ presentacionId: presentacionAId }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('NO_CONSULTORA');
  });

  it('4. presentación de OTRA consultora → 404 NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/rar/presentaciones/[presentacionId]/pdf/route');
    const res = await GET(makeReq(presentacionBId), {
      params: Promise.resolve({ presentacionId: presentacionBId }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('5. UUID válido inexistente → 404 NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/rar/presentaciones/[presentacionId]/pdf/route');
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const res = await GET(makeReq(fakeUuid), {
      params: Promise.resolve({ presentacionId: fakeUuid }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('6. consultora con trial vencido → 402 BILLING_GATED', async () => {
    await signInAs(emailOwnerC);
    const { GET } = await import('@/app/api/rar/presentaciones/[presentacionId]/pdf/route');
    const res = await GET(makeReq(presentacionCId), {
      params: Promise.resolve({ presentacionId: presentacionCId }),
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { code: string }).code).toBe('BILLING_GATED');
  });

  it('7. happy path desde snapshot → 200 + application/pdf + filename por período + magic bytes', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/rar/presentaciones/[presentacionId]/pdf/route');
    const res = await GET(makeReq(presentacionAId), {
      params: Promise.resolve({ presentacionId: presentacionAId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');

    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/attachment;/);
    expect(cd).toMatch(/filename="planilla-rar-[a-z0-9-]+-2025\.pdf"/);
    expect(cd).toMatch(/filename\*=UTF-8''/);

    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');

    const printCalls = fetchMock.mock.calls.filter(([input]) => {
      const u =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return u.includes('/rar/presentaciones/') && u.endsWith('/print');
    });
    expect(printCalls).toHaveLength(1);
    const headers = printCalls[0]![1]?.headers as Record<string, string>;
    expect(headers['x-internal-pdf-render']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('8. PdfRenderTimeoutError de htmlToPdf → 504 RENDER_TIMEOUT', async () => {
    await signInAs(emailOwnerA);
    const { PdfRenderTimeoutError } = await import('@/shared/pdf/render');
    mockHtmlToPdf.mockRejectedValueOnce(new PdfRenderTimeoutError('pdf', 15000));
    const { GET } = await import('@/app/api/rar/presentaciones/[presentacionId]/pdf/route');
    const res = await GET(makeReq(presentacionAId), {
      params: Promise.resolve({ presentacionId: presentacionAId }),
    });
    expect(res.status).toBe(504);
    expect(((await res.json()) as { code: string }).code).toBe('RENDER_TIMEOUT');
  });
});
