/**
 * T-023 · Tests del audit_log para GET /api/informes/[id]/pdf.
 *
 * Cubre el contrato con la tabla `public.audit_log`:
 *  1. GET exitoso → fila en audit_log con action='informe_exported_pdf',
 *     entity_id correcto, actor_user_id correcto, after_data con metadata
 *     util (titulo, tipo, pdf_size_bytes, content_size, generation_ms).
 *  2. htmlToPdf lanza error → NO hay fila en audit_log (no se exporto nada).
 *
 * Patron de mocks identico a pdf-route-auth.test.ts pero el mock de
 * htmlToPdf se reconfigura por test (success vs reject).
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
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

// CHORE-D · I5: el handler usa `after(cb)` de next/server, que requiere request
// scope. Los tests invocan el handler directo (sin Next request context), asi
// que mockeamos para ejecutar la callback sincronamente — equivalente al
// comportamiento previo `void cb()`. El polling de audit_log abajo cubre el
// timing del INSERT.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => {
      void cb();
    },
  };
});

const mockHtmlToPdf = vi.fn();
vi.mock('@/shared/pdf/render', () => ({
  htmlToPdf: mockHtmlToPdf,
  PdfRenderTimeoutError: class PdfRenderTimeoutError extends Error {
    constructor(stage: string, timeoutMs: number) {
      super(`PDF render timeout en stage "${stage}" (${timeoutMs} ms)`);
      this.name = 'PdfRenderTimeoutError';
    }
  },
}));

// Mock de fetch global: SOLO interceptamos URLs que terminen en `/print` —
// el resto pasa al fetch real (Supabase auth necesita la API real).
const originalFetch = global.fetch;
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const urlStr =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (urlStr.includes('/informes/') && urlStr.endsWith('/print')) {
    return Promise.resolve(
      new Response('<html><body>fake</body></html>', {
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
const slug = `t023-audit-${runId}`;
const emailOwner = `t023-audit-owner-${runId}@example.com`;

let consultoraId: string;
let ownerId: string;
let informeOkId: string;
let informeFailId: string;

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T023 audit', slug })
    .select('id')
    .single();
  consultoraId = c!.id;

  const { data: u } = await admin.auth.admin.createUser({
    email: emailOwner,
    password,
    email_confirm: true,
  });
  ownerId = u.user!.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: consultoraId, role: 'owner' });

  await admin.auth.admin.updateUserById(ownerId, {
    app_metadata: { consultora_id: consultoraId },
  });

  // 2 informes con contenido — uno para test happy path, otro para fail path.
  const { data: i1 } = await admin
    .from('informes')
    .insert({
      consultora_id: consultoraId,
      tipo: 'capacitacion',
      titulo: 'Audit happy',
      created_by: ownerId,
      contenido: '# Audit happy path\n\nLorem ipsum.',
    })
    .select('id')
    .single();
  informeOkId = i1!.id;

  const { data: i2 } = await admin
    .from('informes')
    .insert({
      consultora_id: consultoraId,
      tipo: 'accidente',
      titulo: 'Audit fail',
      created_by: ownerId,
      contenido: '# Should not be audited\n\nrender va a fallar.',
    })
    .select('id')
    .single();
  informeFailId = i2!.id;
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(ownerId).catch(() => {});
});

beforeEach(() => {
  cookieStore.length = 0;
  fetchMock.mockClear();
  mockHtmlToPdf.mockReset();
  global.fetch = fetchMock;
});

afterAll(() => {
  global.fetch = originalFetch;
});

async function signIn(): Promise<void> {
  cookieStore.length = 0;
  const { createClient: createServerClient } = await import('@/shared/supabase/server');
  const sb = await createServerClient();
  const { error } = await sb.auth.signInWithPassword({ email: emailOwner, password });
  expect(error).toBeNull();
}

function makeReq(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/informes/${id}/pdf`, {
    method: 'GET',
    headers: { 'user-agent': 'vitest-audit', 'x-forwarded-for': '10.0.0.1' },
  });
}

describe('GET /api/informes/[id]/pdf · audit_log', () => {
  it('1. happy path inserta fila informe_exported_pdf con metadata correcta', async () => {
    await signIn();
    const fakePdf = Buffer.from('%PDF-1.4\n%audit test\n%%EOF\n', 'utf-8');
    mockHtmlToPdf.mockResolvedValueOnce(fakePdf);

    const { GET } = await import('@/app/api/informes/[id]/pdf/route');
    const res = await GET(makeReq(informeOkId), {
      params: Promise.resolve({ id: informeOkId }),
    });
    expect(res.status).toBe(200);
    // Consumimos el body para asegurar que el await writeAuditLog se dispatch
    // — la insercion es fire-and-forget pero el handler ya disparo la promesa.
    await res.arrayBuffer();

    // Polling corto: el audit insert es async (void write). 1s es suficiente.
    let auditRow: {
      action: string;
      entity_type: string | null;
      entity_id: string | null;
      actor_user_id: string | null;
      after_data: unknown;
      user_agent: string | null;
    } | null = null;
    for (let i = 0; i < 10; i++) {
      const { data } = await admin
        .from('audit_log')
        .select('action, entity_type, entity_id, actor_user_id, after_data, user_agent')
        .eq('action', 'informe_exported_pdf')
        .eq('entity_id', informeOkId)
        .maybeSingle();
      if (data) {
        auditRow = data;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(auditRow).not.toBeNull();
    expect(auditRow?.action).toBe('informe_exported_pdf');
    expect(auditRow?.entity_type).toBe('informes');
    expect(auditRow?.entity_id).toBe(informeOkId);
    expect(auditRow?.actor_user_id).toBe(ownerId);
    expect(auditRow?.user_agent).toBe('vitest-audit');

    const after = auditRow?.after_data as Record<string, unknown>;
    expect(after.titulo).toBe('Audit happy');
    expect(after.tipo).toBe('capacitacion');
    expect(after.pdf_size_bytes).toBe(fakePdf.length);
    expect(typeof after.content_size).toBe('number');
    expect(after.content_size).toBeGreaterThan(0);
    expect(typeof after.generation_ms).toBe('number');
  });

  it('2. htmlToPdf rechaza → NO hay fila informe_exported_pdf en audit_log', async () => {
    await signIn();
    mockHtmlToPdf.mockRejectedValueOnce(new Error('chromium crash'));

    const { GET } = await import('@/app/api/informes/[id]/pdf/route');
    const res = await GET(makeReq(informeFailId), {
      params: Promise.resolve({ id: informeFailId }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INTERNAL_ERROR');

    // Damos un tiempo similar al test anterior para que un eventual insert
    // tardio aparezca — no deberia haber ninguno.
    await new Promise((r) => setTimeout(r, 600));
    const { data, count } = await admin
      .from('audit_log')
      .select('id', { count: 'exact' })
      .eq('action', 'informe_exported_pdf')
      .eq('entity_id', informeFailId);
    expect(count).toBe(0);
    expect(data).toHaveLength(0);
  });
});
