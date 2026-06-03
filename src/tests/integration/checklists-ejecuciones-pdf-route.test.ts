/**
 * T-060b · Tests del route handler GET /api/checklists/ejecuciones/[id]/pdf.
 *
 * Gates del endpoint (molde EPP T-104): id malformado → 400; sin cookie → 401;
 * sin consultora → 403; borrador → 422 NOT_CLOSED; cross-tenant → 404; happy
 * (cerrada) → 200 application/pdf + Content-Disposition `inspeccion-rgrl-…`.
 *
 * Mocks: htmlToPdf → buffer fake con magic bytes %PDF-; fetch global intercepta
 * la URL del print page; `after` corre sincrónico. El render real del print page
 * NO se ejercita acá (necesita server + Puppeteer) — se valida en E2E/manual.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestConsultora } from './helpers/consultora';

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
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: (cb: () => Promise<void> | void) => void cb() };
});

const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4\n%fake checklist rgrl\n%%EOF\n', 'utf-8');
const mockHtmlToPdf = vi.fn().mockResolvedValue(FAKE_PDF_BUFFER);
vi.mock('@/shared/pdf/render', () => ({
  htmlToPdf: mockHtmlToPdf,
  PdfRenderTimeoutError: class PdfRenderTimeoutError extends Error {},
}));

const originalFetch = global.fetch;
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const urlStr =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (urlStr.includes('/checklists/ejecuciones/') && urlStr.endsWith('/print')) {
    return Promise.resolve(
      new Response('<html><body>fake rgrl print</body></html>', {
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
  throw new Error('Tests requieren NEXT_PUBLIC_SUPABASE_URL, ANON_KEY y SERVICE_ROLE_KEY.');
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';
const slugA = `t060bpdf-a-${runId}`;
const slugB = `t060bpdf-b-${runId}`;
const emailOwnerA = `t060bpdf-a-${runId}@example.com`;
const emailOwnerB = `t060bpdf-b-${runId}@example.com`;
const emailNoConsul = `t060bpdf-nc-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let noConsulId: string;
let clienteAId: string;
let cerradaAId: string;
let borradorAId: string;

async function mkUser(email: string): Promise<string> {
  const u = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (u.error || !u.data.user) throw new Error(`createUser ${email}: ${JSON.stringify(u.error)}`);
  return u.data.user.id;
}

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
  return new NextRequest(`http://localhost:3000/api/checklists/ejecuciones/${id}/pdf`, {
    method: 'GET',
    headers: { 'user-agent': 'vitest', 'x-forwarded-for': '127.0.0.1' },
  });
}

beforeAll(async () => {
  cAId = (await createTestConsultora(admin, { name: 'T060bPdfA', slug: slugA })).id;
  cBId = (await createTestConsultora(admin, { name: 'T060bPdfB', slug: slugB })).id;
  ownerAId = await mkUser(emailOwnerA);
  ownerBId = await mkUser(emailOwnerB);
  noConsulId = await mkUser(emailNoConsul);

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);
  await admin.auth.admin.updateUserById(ownerAId, {
    app_metadata: { consultora_id: cAId, consultora_role: 'owner' },
  });
  await admin.auth.admin.updateUserById(ownerBId, {
    app_metadata: { consultora_id: cBId, consultora_role: 'owner' },
  });

  const cuitBase = Date.now().toString().slice(-8).padStart(8, '0');
  clienteAId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Cliente A ${runId}`,
        cuit: `30-${cuitBase}-1`,
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;

  // Versión publicada del template de sistema RGRL (FK template_version_id).
  const { data: sys } = await admin
    .from('checklist_templates')
    .select('id')
    .is('consultora_id', null)
    .eq('tipo_inspeccion', 'rgrl_463_09')
    .limit(1)
    .maybeSingle();
  if (!sys) throw new Error('No se encontró el template de sistema RGRL (seed T-057).');
  const { data: sysVer } = await admin
    .from('checklist_template_versions')
    .select('id')
    .eq('template_id', sys.id)
    .eq('estado', 'published')
    .limit(1)
    .maybeSingle();
  if (!sysVer) throw new Error('No se encontró la versión publicada del sistema.');

  // Ejecución CERRADA (insert directo service-role: el route solo valida estado).
  cerradaAId = (
    await admin
      .from('checklist_executions')
      .insert({
        consultora_id: cAId,
        template_version_id: sysVer.id,
        cliente_id: clienteAId,
        estado: 'cerrada',
        cerrada_at: new Date().toISOString(),
        fecha_inspeccion: '2026-06-03',
        score_cumple: 1,
        score_no_cumple: 0,
        score_na: 0,
        cumplimiento_pct: 100,
        tiene_criticos_incumplidos: false,
        establecimiento_razon_social: `Cliente A ${runId}`,
        firma_pdf_hash: 'a'.repeat(64),
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;

  // Ejecución BORRADOR.
  borradorAId = (
    await admin
      .from('checklist_executions')
      .insert({
        consultora_id: cAId,
        template_version_id: sysVer.id,
        cliente_id: clienteAId,
        estado: 'borrador',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
});

afterAll(async () => {
  await admin.from('checklist_executions').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('clientes').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('consultora_members').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('consultoras').delete().in('id', [cAId, cBId]);
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

describe('GET /api/checklists/ejecuciones/[id]/pdf', () => {
  it('1. id malformado → 400 INVALID_INPUT', async () => {
    const { GET } = await import('@/app/api/checklists/ejecuciones/[id]/pdf/route');
    const res = await GET(makeReq('not-a-uuid'), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
  });

  it('2. sin cookie → 401 UNAUTHENTICATED', async () => {
    const { GET } = await import('@/app/api/checklists/ejecuciones/[id]/pdf/route');
    const res = await GET(makeReq(cerradaAId), { params: Promise.resolve({ id: cerradaAId }) });
    expect(res.status).toBe(401);
  });

  it('3. user sin consultora → 403 NO_CONSULTORA', async () => {
    await signInAs(emailNoConsul);
    const { GET } = await import('@/app/api/checklists/ejecuciones/[id]/pdf/route');
    const res = await GET(makeReq(cerradaAId), { params: Promise.resolve({ id: cerradaAId }) });
    expect(res.status).toBe(403);
  });

  it('4. borrador → 422 NOT_CLOSED', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/checklists/ejecuciones/[id]/pdf/route');
    const res = await GET(makeReq(borradorAId), { params: Promise.resolve({ id: borradorAId }) });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_CLOSED');
  });

  it('5. cross-tenant: ownerB pide la cerrada de A → 404 NOT_FOUND', async () => {
    await signInAs(emailOwnerB);
    const { GET } = await import('@/app/api/checklists/ejecuciones/[id]/pdf/route');
    const res = await GET(makeReq(cerradaAId), { params: Promise.resolve({ id: cerradaAId }) });
    expect(res.status).toBe(404);
  });

  it('6. cerrada (owner) → 200 application/pdf + filename inspeccion-rgrl-…', async () => {
    await signInAs(emailOwnerA);
    const { GET } = await import('@/app/api/checklists/ejecuciones/[id]/pdf/route');
    const res = await GET(makeReq(cerradaAId), { params: Promise.resolve({ id: cerradaAId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('inspeccion-rgrl-');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString('utf-8')).toBe('%PDF-');
    expect(mockHtmlToPdf).toHaveBeenCalledTimes(1);
  });
});
