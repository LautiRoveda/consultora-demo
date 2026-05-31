/**
 * T-024 · Tests del route handler POST /api/settings/consultora/logo y la
 * server action removeConsultoraLogoAction.
 *
 * Cobertura:
 *  - Auth + owner-only gate.
 *  - Validaciones MIME + size.
 *  - Happy path upload: storage + UPDATE consultoras.logo_storage_path.
 *  - Replace logo: borra el path previo.
 *  - Remove action: borra storage + clear column.
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
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
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

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';

const slug = `t024logo-${runId}`;
const emailOwner = `t024logo-own-${runId}@example.com`;
const emailMember = `t024logo-mem-${runId}@example.com`;

let cId: string;
let ownerId: string;
let memberId: string;

const pathsToClean: string[] = [];

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T024 Logo', slug })
    .select('id')
    .single();
  cId = c!.id;

  const [{ data: uOwn }, { data: uMem }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailOwner, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailMember, password, email_confirm: true }),
  ]);
  ownerId = uOwn.user!.id;
  memberId = uMem.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerId, consultora_id: cId, role: 'owner' },
    { user_id: memberId, consultora_id: cId, role: 'member' },
  ]);

  await Promise.all([
    admin.auth.admin.updateUserById(ownerId, { app_metadata: { consultora_id: cId } }),
    admin.auth.admin.updateUserById(memberId, { app_metadata: { consultora_id: cId } }),
  ]);
});

afterAll(async () => {
  if (pathsToClean.length > 0) {
    await admin.storage
      .from('consultora-logos')
      .remove(pathsToClean)
      .catch(() => {});
  }
  await Promise.all([
    admin.auth.admin.deleteUser(ownerId).catch(() => {}),
    admin.auth.admin.deleteUser(memberId).catch(() => {}),
  ]);
});

beforeEach(() => {
  cookieStore.length = 0;
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

function makeUploadReq(file: Blob): NextRequest {
  const fd = new FormData();
  fd.append('file', file);
  return new NextRequest('http://localhost:3000/api/settings/consultora/logo', {
    method: 'POST',
    body: fd,
  });
}

describe('POST /api/settings/consultora/logo — gates', () => {
  it('1. sin sesion → 401', async () => {
    const { POST } = await import('@/app/api/settings/consultora/logo/route');
    const res = await POST(makeUploadReq(new Blob([PNG_1X1], { type: 'image/png' })));
    expect(res.status).toBe(401);
  });

  it('2. member non-owner → 403 FORBIDDEN', async () => {
    await signInAs(emailMember);
    const { POST } = await import('@/app/api/settings/consultora/logo/route');
    const res = await POST(makeUploadReq(new Blob([PNG_1X1], { type: 'image/png' })));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('3. MIME unsupported (PDF) → 415', async () => {
    await signInAs(emailOwner);
    const { POST } = await import('@/app/api/settings/consultora/logo/route');
    const res = await POST(
      makeUploadReq(new Blob([Buffer.from('%PDF-')], { type: 'application/pdf' })),
    );
    expect(res.status).toBe(415);
  });

  it('4. size > 2 MB → 413', async () => {
    await signInAs(emailOwner);
    const oversize = Buffer.alloc(2 * 1024 * 1024 + 1, 0x00);
    PNG_1X1.copy(oversize, 0, 0, 8);
    const { POST } = await import('@/app/api/settings/consultora/logo/route');
    const res = await POST(makeUploadReq(new Blob([oversize], { type: 'image/png' })));
    expect(res.status).toBe(413);
  });
});

describe('POST /api/settings/consultora/logo — happy paths', () => {
  it('5. happy path: upload owner → 201 + consultoras.logo_storage_path actualizado', async () => {
    await signInAs(emailOwner);
    const { POST } = await import('@/app/api/settings/consultora/logo/route');
    const res = await POST(makeUploadReq(new File([PNG_1X1], 'logo.png', { type: 'image/png' })));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; logoStoragePath: string };
    expect(body.ok).toBe(true);
    expect(body.logoStoragePath).toMatch(/^[0-9a-f-]{36}\/logo-\d+\.png$/);

    pathsToClean.push(body.logoStoragePath);

    // DB column updated.
    const { data: row } = await admin
      .from('consultoras')
      .select('logo_storage_path')
      .eq('id', cId)
      .single();
    expect(row?.logo_storage_path).toBe(body.logoStoragePath);

    // Storage object presente.
    const { data: obj } = await admin.storage
      .from('consultora-logos')
      .download(body.logoStoragePath);
    expect(obj).not.toBeNull();
  });

  it('6. replace logo: borra el path previo + actualiza el nuevo', async () => {
    await signInAs(emailOwner);
    const { POST } = await import('@/app/api/settings/consultora/logo/route');

    // Logo previo (puede venir del test 5 o lo creamos defensivamente).
    const { data: pre } = await admin
      .from('consultoras')
      .select('logo_storage_path')
      .eq('id', cId)
      .single();
    const previousPath = pre?.logo_storage_path;
    expect(previousPath).not.toBeNull();

    // Esperar 5 ms para que el timestamp del path nuevo no colisione con el previo.
    await new Promise((r) => setTimeout(r, 5));

    const res = await POST(
      makeUploadReq(new File([PNG_1X1], 'logo-v2.png', { type: 'image/png' })),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { logoStoragePath: string };
    pathsToClean.push(body.logoStoragePath);

    expect(body.logoStoragePath).not.toBe(previousPath);

    // Path nuevo en DB.
    const { data: post } = await admin
      .from('consultoras')
      .select('logo_storage_path')
      .eq('id', cId)
      .single();
    expect(post?.logo_storage_path).toBe(body.logoStoragePath);

    // Path previo eliminado del bucket. Usamos list() en vez de download()
    // porque download tiene un cache layer (CDN) que puede devolver el blob
    // por algunos segundos despues del remove. list() consulta la metadata
    // del bucket directamente.
    if (previousPath) {
      const slashIdx = previousPath.lastIndexOf('/');
      const folder = previousPath.slice(0, slashIdx);
      const filename = previousPath.slice(slashIdx + 1);
      let cleaned = false;
      for (let i = 0; i < 15; i += 1) {
        const { data: list } = await admin.storage
          .from('consultora-logos')
          .list(folder, { search: filename });
        const match = list?.find((f) => f.name === filename);
        if (!match) {
          cleaned = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(cleaned).toBe(true);
    }
  });

  it('7. removeConsultoraLogoAction: borra storage + clear column', async () => {
    await signInAs(emailOwner);
    // Verificar que hay logo (heredado de test 5/6).
    const { data: pre } = await admin
      .from('consultoras')
      .select('logo_storage_path')
      .eq('id', cId)
      .single();
    const path = pre?.logo_storage_path;
    expect(path).not.toBeNull();

    const { removeConsultoraLogoAction } = await import('@/app/(app)/settings/consultora/actions');
    const result = await removeConsultoraLogoAction();
    expect(result.ok).toBe(true);

    const { data: post } = await admin
      .from('consultoras')
      .select('logo_storage_path')
      .eq('id', cId)
      .single();
    expect(post?.logo_storage_path).toBeNull();

    if (path) {
      const { data: obj } = await admin.storage.from('consultora-logos').download(path);
      expect(obj).toBeNull();
    }
  });

  it('8. removeConsultoraLogoAction: idempotent cuando ya no hay logo', async () => {
    await signInAs(emailOwner);
    const { removeConsultoraLogoAction } = await import('@/app/(app)/settings/consultora/actions');
    const result = await removeConsultoraLogoAction();
    expect(result.ok).toBe(true);
  });

  it('9. removeConsultoraLogoAction: member non-owner → FORBIDDEN', async () => {
    await signInAs(emailMember);
    const { removeConsultoraLogoAction } = await import('@/app/(app)/settings/consultora/actions');
    const result = await removeConsultoraLogoAction();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN');
  });
});
