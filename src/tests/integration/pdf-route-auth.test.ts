/**
 * T-023 · Tests del route handler GET /api/informes/[id]/pdf — auth + permisos.
 *
 * Cubre los gates del endpoint:
 *  1. id mal formado (no UUID) → 400 INVALID_INPUT.
 *  2. sin cookies → 401 UNAUTHENTICATED.
 *  3. user sin consultora → 403 NO_CONSULTORA.
 *  4. informe de OTRA consultora (RLS scope) → 404 NOT_FOUND.
 *  5. informe con contenido vacio → 422 EMPTY_CONTENT.
 *  6. happy path → 200 con Content-Type application/pdf, body magic bytes
 *     `%PDF-`, header Content-Disposition con filename.
 *
 * Mocks:
 *  - server-only, next/headers, next/cache: stubs estandar (heredados de
 *    informes-content-actions.test.ts).
 *  - global fetch: stub que devuelve un HTML fake del print page sin pegarle
 *    al Next.js server real (no hay server en tests integration).
 *  - @/shared/pdf/render: mock de htmlToPdf que devuelve un Buffer
 *    `%PDF-1.4\n...` sin levantar Chromium en CI.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestConsultora } from './helpers/consultora';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) => {
        // El layout (print)/layout.tsx lee `x-internal-pdf-render`. En estos
        // tests no llegamos a renderear ese layout (mock de fetch + mock de
        // htmlToPdf), pero defensivamente devolvemos null para evitar surprises.
        if (name.toLowerCase() === 'x-internal-pdf-render') return null;
        return null;
      },
    }),
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

// CHORE-D · I5: handler usa `after(cb)`, requiere request scope. En tests
// invocamos el handler directo — mockeamos para ejecutar la callback
// sincronamente.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => {
      void cb();
    },
  };
});

// Mock de htmlToPdf: devuelve un buffer con magic bytes %PDF- para que el
// caller no detecte que no es PDF real, sin levantar Chromium. Cualquier test
// que necesite el contenido real del PDF debe ser E2E (PARADA #3).
const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4\n%fake test pdf\n%%EOF\n', 'utf-8');
vi.mock('@/shared/pdf/render', () => ({
  htmlToPdf: vi.fn().mockResolvedValue(FAKE_PDF_BUFFER),
  PdfRenderTimeoutError: class PdfRenderTimeoutError extends Error {},
}));

// Mock de fetch global: el route handler hace fetch interno al print page.
// SOLO interceptamos URLs que terminen en `/print` — el resto pasa al fetch
// real (necesario para que Supabase auth hable con la API real de
// supabase.co; sin esto el signIn devuelve "<html>..." y rompe).
const originalFetch = global.fetch;
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const urlStr =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (urlStr.includes('/informes/') && urlStr.endsWith('/print')) {
    return Promise.resolve(
      new Response('<html><body>fake print page</body></html>', {
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
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';

const slugA = `t023-ca-${runId}`;
const slugB = `t023-cb-${runId}`;
const emailOwnerA = `t023-owner-a-${runId}@example.com`;
const emailOwnerB = `t023-owner-b-${runId}@example.com`;
const emailNoConsul = `t023-noconsul-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let noConsulId: string;
let informeWithContentInCa: string;
let informeEmptyInCa: string;
let informeInCb: string;

beforeAll(async () => {
  const [cA, cB] = await Promise.all([
    createTestConsultora(admin, { name: 'T023 cA', slug: slugA }),
    createTestConsultora(admin, { name: 'T023 cB', slug: slugB }),
  ]);
  cAId = cA.id;
  cBId = cB.id;

  const [{ data: uOA }, { data: uOB }, { data: uNc }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailNoConsul, password, email_confirm: true }),
  ]);
  ownerAId = uOA.user!.id;
  ownerBId = uOB.user!.id;
  noConsulId = uNc.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
    // noConsul user: explicitamente SIN claim ni membership.
  ]);

  // Informe con contenido en cA.
  const { data: i1 } = await admin
    .from('informes')
    .insert({
      consultora_id: cAId,
      tipo: 'rgrl',
      titulo: 'Informe RGRL para PDF',
      created_by: ownerAId,
      contenido: '# Informe RGRL\n\nContenido de prueba para PDF.',
    })
    .select('id')
    .single();
  informeWithContentInCa = i1!.id;

  // Informe vacio en cA.
  const { data: i2 } = await admin
    .from('informes')
    .insert({
      consultora_id: cAId,
      tipo: 'otros',
      titulo: 'Informe vacio',
      created_by: ownerAId,
      contenido: null,
    })
    .select('id')
    .single();
  informeEmptyInCa = i2!.id;

  // Informe en cB (para test cross-tenant).
  const { data: i3 } = await admin
    .from('informes')
    .insert({
      consultora_id: cBId,
      tipo: 'rgrl',
      titulo: 'Informe de la consultora B',
      created_by: ownerBId,
      contenido: '# Tenant B\n\nNo deberia ser accesible.',
    })
    .select('id')
    .single();
  informeInCb = i3!.id;
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
    admin.auth.admin.deleteUser(noConsulId).catch(() => {}),
  ]);
});

beforeEach(() => {
  cookieStore.length = 0;
  fetchMock.mockClear();
  global.fetch = fetchMock;
});

afterAll(() => {
  global.fetch = originalFetch;
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
  return new NextRequest(`http://localhost:3000/api/informes/${id}/pdf`, {
    method: 'GET',
    headers: { 'user-agent': 'vitest', 'x-forwarded-for': '127.0.0.1' },
  });
}

describe('GET /api/informes/[id]/pdf', () => {
  it('1. id malformado (no UUID) → 400 INVALID_INPUT', async () => {
    const { GET } = await import('@/app/api/informes/[id]/pdf/route');
    const res = await GET(makeReq('not-a-uuid'), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('2. sin cookie de sesion → 401 UNAUTHENTICATED', async () => {
    const { GET } = await import('@/app/api/informes/[id]/pdf/route');
    const res = await GET(makeReq(informeWithContentInCa), {
      params: Promise.resolve({ id: informeWithContentInCa }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('3. user autenticado SIN consultora → 403 NO_CONSULTORA', async () => {
    await signInAs(emailNoConsul);
    const { GET } = await import('@/app/api/informes/[id]/pdf/route');
    const res = await GET(makeReq(informeWithContentInCa), {
      params: Promise.resolve({ id: informeWithContentInCa }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NO_CONSULTORA');
  });

  it('4. informe de OTRA consultora (RLS scope) → 404 NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/informes/[id]/pdf/route');
    const res = await GET(makeReq(informeInCb), {
      params: Promise.resolve({ id: informeInCb }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('5. informe con contenido vacio → 422 EMPTY_CONTENT', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/informes/[id]/pdf/route');
    const res = await GET(makeReq(informeEmptyInCa), {
      params: Promise.resolve({ id: informeEmptyInCa }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('EMPTY_CONTENT');
  });

  it('6. happy path → 200 + Content-Type application/pdf + Content-Disposition + magic bytes', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/informes/[id]/pdf/route');
    const res = await GET(makeReq(informeWithContentInCa), {
      params: Promise.resolve({ id: informeWithContentInCa }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');

    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/attachment;/);
    expect(cd).toMatch(/filename="informe-rgrl-informe-rgrl-para-pdf-/);
    expect(cd).toMatch(/\.pdf"/);
    expect(cd).toMatch(/filename\*=UTF-8''/);

    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(0);

    // fetchMock intercepta TODOS los fetch del proceso (incluido el de
    // supabase auth pre-test) — filtramos a la llamada al print page que
    // es la unica que nos importa verificar.
    const printCalls = fetchMock.mock.calls.filter(([input]) => {
      const u =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return u.includes('/informes/') && u.endsWith('/print');
    });
    expect(printCalls).toHaveLength(1);
    const fetchCall = printCalls[0]!;
    const rawUrl = fetchCall[0];
    const fetchedUrl =
      typeof rawUrl === 'string' ? rawUrl : rawUrl instanceof URL ? rawUrl.toString() : rawUrl.url;
    expect(fetchedUrl).toMatch(new RegExp(`/informes/${informeWithContentInCa}/print$`));
    const init = fetchCall[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-internal-pdf-render']).toMatch(/^[0-9a-f]{64}$/);
  });
});
