/**
 * T-104 · Tests del route handler GET /api/epp/entregas/[id]/pdf.
 *
 * Cubre los gates del endpoint (mismo pattern T-023 informes pdf-route-auth):
 *  1. id mal formado → 400 INVALID_INPUT.
 *  2. sin cookies → 401 UNAUTHENTICATED.
 *  3. user sin consultora → 403 NO_CONSULTORA.
 *  4. entrega de OTRA consultora → 404 NOT_FOUND.
 *  5. entrega NO firmada → 422 NOT_SIGNED.
 *  6. entrega UUID válido inexistente → 404 NOT_FOUND.
 *  7. happy path → 200 + Content-Type application/pdf + Content-Disposition
 *     con filename `planilla-299-11-<apellido>-<fecha>.pdf` + magic bytes + headers
 *     Cache-Control no-store + X-Robots-Tag noindex.
 *  8. PdfRenderTimeoutError → 504 RENDER_TIMEOUT.
 *
 * Mocks: igual que pdf-route-auth.test.ts — htmlToPdf devuelve buffer fake con
 * magic bytes %PDF-, fetch global intercepta la URL del print page.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration -- epp-pdf-route`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
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

const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4\n%fake epp planilla\n%%EOF\n', 'utf-8');
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
  if (urlStr.includes('/epp/entregas/') && urlStr.endsWith('/print')) {
    return Promise.resolve(
      new Response('<html><body>fake epp print page</body></html>', {
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

const FIRMA_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';
const slugA = `t104a-${runId}`;
const slugB = `t104b-${runId}`;
const emailOwnerA = `t104-own-a-${runId}@example.com`;
const emailOwnerB = `t104-own-b-${runId}@example.com`;
const emailNoConsul = `t104-noconsul-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let noConsulId: string;
let clienteAId: string;
let clienteBId: string;
let empleadoAId: string;
let empleadoBId: string;
let categoriaAId: string;
let categoriaBId: string;
let itemAId: string;
let itemBId: string;

let entregaSignedAId: string;
let entregaUnsignedAId: string;
let entregaSignedBId: string;

const trackedEntregas: string[] = [];
const trackedStorage: string[] = [];

beforeAll(async () => {
  // Consultoras con trial vigente (defensivo contra BILLING_GATE_DISABLED='false').
  const trialFuture = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  cAId = (
    await admin
      .from('consultoras')
      .insert({ name: 'T104 A', slug: slugA, plan: 'trial', trial_hasta: trialFuture })
      .select('id')
      .single()
  ).data!.id;
  cBId = (
    await admin
      .from('consultoras')
      .insert({ name: 'T104 B', slug: slugB, plan: 'trial', trial_hasta: trialFuture })
      .select('id')
      .single()
  ).data!.id;

  // Users.
  ownerAId = (
    await admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true })
  ).data.user!.id;
  ownerBId = (
    await admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true })
  ).data.user!.id;
  noConsulId = (
    await admin.auth.admin.createUser({ email: emailNoConsul, password, email_confirm: true })
  ).data.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, {
      app_metadata: { consultora_id: cAId, consultora_role: 'owner' },
    }),
    admin.auth.admin.updateUserById(ownerBId, {
      app_metadata: { consultora_id: cBId, consultora_role: 'owner' },
    }),
  ]);

  const cuitBase = Date.now().toString().slice(-8).padStart(8, '0');
  const cuitA = `33-${cuitBase}-3`;
  const cuitB = `23-${cuitBase}-4`;

  clienteAId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Cliente T104A ${runId}`,
        cuit: cuitA,
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
        razon_social: `Cliente T104B ${runId}`,
        cuit: cuitB,
        created_by: ownerBId,
      })
      .select('id')
      .single()
  ).data!.id;

  empleadoAId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Ana',
        apellido: 'Lopez',
        dni: '20555666',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;

  empleadoBId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cBId,
        cliente_id: clienteBId,
        nombre: 'Mario',
        apellido: 'Diaz',
        dni: '20777888',
        created_by: ownerBId,
      })
      .select('id')
      .single()
  ).data!.id;

  categoriaAId = (
    await admin
      .from('epp_categorias')
      .insert({ consultora_id: cAId, nombre: `Cat T104A ${runId}`, created_by: ownerAId })
      .select('id')
      .single()
  ).data!.id;

  categoriaBId = (
    await admin
      .from('epp_categorias')
      .insert({ consultora_id: cBId, nombre: `Cat T104B ${runId}`, created_by: ownerBId })
      .select('id')
      .single()
  ).data!.id;

  itemAId = (
    await admin
      .from('epp_items')
      .insert({
        consultora_id: cAId,
        categoria_id: categoriaAId,
        nombre: `Casco T104A ${runId}`,
        vida_util_meses: 24,
        es_descartable: false,
        requiere_numero_serie: false,
        normativa: 'IRAM 3620',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;

  itemBId = (
    await admin
      .from('epp_items')
      .insert({
        consultora_id: cBId,
        categoria_id: categoriaBId,
        nombre: `Casco T104B ${runId}`,
        vida_util_meses: 24,
        es_descartable: false,
        requiere_numero_serie: false,
        created_by: ownerBId,
      })
      .select('id')
      .single()
  ).data!.id;

  // Entrega firmada en A via server action (shape consistente con prod).
  await signInAs(emailOwnerA);
  const { createEntregaAction } = await import('@/app/(app)/epp/entregas/actions');
  const rA = await createEntregaAction({
    empleado_id: empleadoAId,
    items: [{ item_id: itemAId, cantidad: 1, motivo_entrega: 'inicial' }],
    firma_base64: FIRMA_PNG_BASE64,
  });
  if (!rA.ok) throw new Error(`Setup A signed entrega: ${rA.code} ${rA.message}`);
  entregaSignedAId = rA.entregaId;
  trackedEntregas.push(entregaSignedAId);
  trackedStorage.push(`${cAId}/${entregaSignedAId}.png`);

  // Entrega NO firmada en A: insert directo con firmado_at=null.
  entregaUnsignedAId = (
    await admin
      .from('epp_entregas')
      .insert({
        consultora_id: cAId,
        empleado_id: empleadoAId,
        cliente_id: clienteAId,
        firmado_at: null,
        firma_storage_path: null,
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  trackedEntregas.push(entregaUnsignedAId);
  await admin.from('epp_entrega_items').insert({
    entrega_id: entregaUnsignedAId,
    item_id: itemAId,
    consultora_id: cAId,
    cantidad: 1,
    motivo_entrega: 'inicial',
  });

  // Entrega firmada en B (cross-tenant).
  await signInAs(emailOwnerB);
  const rB = await createEntregaAction({
    empleado_id: empleadoBId,
    items: [{ item_id: itemBId, cantidad: 1, motivo_entrega: 'inicial' }],
    firma_base64: FIRMA_PNG_BASE64,
  });
  if (!rB.ok) throw new Error(`Setup B signed entrega: ${rB.code} ${rB.message}`);
  entregaSignedBId = rB.entregaId;
  trackedEntregas.push(entregaSignedBId);
  trackedStorage.push(`${cBId}/${entregaSignedBId}.png`);
});

afterAll(async () => {
  if (trackedStorage.length > 0) {
    await admin.storage
      .from('epp-firmas')
      .remove(trackedStorage)
      .catch(() => {});
  }
  if (trackedEntregas.length > 0) {
    await admin
      .from('epp_planificaciones')
      .delete()
      .in('generado_de_entrega_id', trackedEntregas)
      .then(() => {});
    await admin
      .from('calendar_events')
      .delete()
      .in('consultora_id', [cAId, cBId])
      .eq('tipo', 'epp_entrega')
      .then(() => {});
    await admin
      .from('epp_entrega_items')
      .delete()
      .in('entrega_id', trackedEntregas)
      .then(() => {});
    await admin
      .from('epp_entregas')
      .delete()
      .in('id', trackedEntregas)
      .then(() => {});
  }
  await admin
    .from('epp_items')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('epp_categorias')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('empleados')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('clientes')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('audit_log')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('consultora_members')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('consultoras')
    .delete()
    .in('id', [cAId, cBId])
    .then(() => {});
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
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

function makeReq(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/epp/entregas/${id}/pdf`, {
    method: 'GET',
    headers: { 'user-agent': 'vitest', 'x-forwarded-for': '127.0.0.1' },
  });
}

describe('GET /api/epp/entregas/[id]/pdf', () => {
  it('1. id malformado → 400 INVALID_INPUT', async () => {
    const { GET } = await import('@/app/api/epp/entregas/[id]/pdf/route');
    const res = await GET(makeReq('not-a-uuid'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('2. sin cookie de sesion → 401 UNAUTHENTICATED', async () => {
    const { GET } = await import('@/app/api/epp/entregas/[id]/pdf/route');
    const res = await GET(makeReq(entregaSignedAId), {
      params: Promise.resolve({ id: entregaSignedAId }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('3. user autenticado SIN consultora → 403 NO_CONSULTORA', async () => {
    await signInAs(emailNoConsul);
    const { GET } = await import('@/app/api/epp/entregas/[id]/pdf/route');
    const res = await GET(makeReq(entregaSignedAId), {
      params: Promise.resolve({ id: entregaSignedAId }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NO_CONSULTORA');
  });

  it('4. entrega de OTRA consultora → 404 NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/epp/entregas/[id]/pdf/route');
    const res = await GET(makeReq(entregaSignedBId), {
      params: Promise.resolve({ id: entregaSignedBId }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('5. entrega NO firmada → 422 NOT_SIGNED', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/epp/entregas/[id]/pdf/route');
    const res = await GET(makeReq(entregaUnsignedAId), {
      params: Promise.resolve({ id: entregaUnsignedAId }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_SIGNED');
  });

  it('6. UUID válido inexistente → 404 NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/epp/entregas/[id]/pdf/route');
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const res = await GET(makeReq(fakeUuid), { params: Promise.resolve({ id: fakeUuid }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('7. happy path → 200 + Content-Type application/pdf + headers + magic bytes', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/epp/entregas/[id]/pdf/route');
    const res = await GET(makeReq(entregaSignedAId), {
      params: Promise.resolve({ id: entregaSignedAId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');

    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/attachment;/);
    expect(cd).toMatch(/filename="planilla-299-11-lopez-\d{4}-\d{2}-\d{2}\.pdf"/);
    expect(cd).toMatch(/filename\*=UTF-8''/);

    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(0);

    const printCalls = fetchMock.mock.calls.filter(([input]) => {
      const u =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return u.includes('/epp/entregas/') && u.endsWith('/print');
    });
    expect(printCalls).toHaveLength(1);
    const fetchCall = printCalls[0]!;
    const init = fetchCall[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-internal-pdf-render']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('8. PdfRenderTimeoutError de htmlToPdf → 504 RENDER_TIMEOUT', async () => {
    await signInAs(emailOwnerA);
    const { PdfRenderTimeoutError } = await import('@/shared/pdf/render');
    mockHtmlToPdf.mockRejectedValueOnce(new PdfRenderTimeoutError('pdf', 15000));
    const { GET } = await import('@/app/api/epp/entregas/[id]/pdf/route');
    const res = await GET(makeReq(entregaSignedAId), {
      params: Promise.resolve({ id: entregaSignedAId }),
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('RENDER_TIMEOUT');
  });
});
