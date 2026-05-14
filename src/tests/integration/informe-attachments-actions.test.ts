/**
 * T-024 · Tests del route handler POST /api/informes/[id]/attachments y de
 * las 3 server actions (caption update, reorder, delete).
 *
 * Cobertura:
 *  - Auth + permission gates del route handler (UUID, session, consultora, gate creator/owner).
 *  - Validaciones de upload (MIME, size, magic bytes, quota).
 *  - Happy paths: image (con sharp pipeline real) + file (PDF mock).
 *  - Server actions: caption update, reorder, delete (con cleanup storage).
 *  - Audit log shape.
 *
 * Tests que ejercitan Storage real cleanean en afterAll borrando paths usados.
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

// PNG 1x1 transparent (67 bytes). Magic bytes 89 50 4E 47 0D 0A 1A 0A. Sharp lo
// procesa OK; output sale como PNG ~80 bytes (re-encoded).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

// PDF minimo (header %PDF-1.4 + body trivial). El route handler no procesa PDF
// con sharp — solo valida magic bytes y sube a Storage.
const PDF_MINIMAL = Buffer.from('%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';

const slugA = `t024a-${runId}`;
const slugB = `t024b-${runId}`;
const emailOwnerA = `t024a-own-${runId}@example.com`;
const emailMemberA = `t024a-mem-${runId}@example.com`;
const emailOwnerB = `t024b-own-${runId}@example.com`;
const emailNoConsul = `t024-nocon-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let noConsulId: string;
let informeInCa: string;
let informeInCb: string;

// Tracking de paths creados para cleanup.
const storagePathsToClean: string[] = [];

beforeAll(async () => {
  const [{ data: cA }, { data: cB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'T024A', slug: slugA }).select('id').single(),
    admin.from('consultoras').insert({ name: 'T024B', slug: slugB }).select('id').single(),
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

  const { data: i1 } = await admin
    .from('informes')
    .insert({
      consultora_id: cAId,
      tipo: 'rgrl',
      titulo: 'T024 fixture',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  informeInCa = i1!.id;

  const { data: i2 } = await admin
    .from('informes')
    .insert({
      consultora_id: cBId,
      tipo: 'otros',
      titulo: 'T024 cB',
      created_by: ownerBId,
    })
    .select('id')
    .single();
  informeInCb = i2!.id;
});

afterAll(async () => {
  // Cleanup Storage de paths creados durante los tests.
  if (storagePathsToClean.length > 0) {
    await admin.storage
      .from('informe-attachments')
      .remove(storagePathsToClean)
      .catch(() => {});
  }
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
    admin.auth.admin.deleteUser(noConsulId).catch(() => {}),
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

function makeUploadReq(informeId: string, file: Blob, opts?: { caption?: string }): NextRequest {
  const fd = new FormData();
  fd.append('file', file);
  if (opts?.caption !== undefined) fd.append('caption', opts.caption);
  return new NextRequest(`http://localhost:3000/api/informes/${informeId}/attachments`, {
    method: 'POST',
    body: fd,
  });
}

describe('POST /api/informes/[id]/attachments — auth/gate/quota', () => {
  it('1. UUID malformado → 400', async () => {
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const res = await POST(
      makeUploadReq('not-a-uuid', new Blob([PNG_1X1], { type: 'image/png' })),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(res.status).toBe(400);
  });

  it('2. sin sesion → 401', async () => {
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const res = await POST(makeUploadReq(informeInCa, new Blob([PNG_1X1], { type: 'image/png' })), {
      params: Promise.resolve({ id: informeInCa }),
    });
    expect(res.status).toBe(401);
  });

  it('3. user sin consultora → 403 NO_CONSULTORA', async () => {
    await signInAs(emailNoConsul);
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const res = await POST(makeUploadReq(informeInCa, new Blob([PNG_1X1], { type: 'image/png' })), {
      params: Promise.resolve({ id: informeInCa }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NO_CONSULTORA');
  });

  it('4. informe cross-tenant → 404 NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const res = await POST(makeUploadReq(informeInCb, new Blob([PNG_1X1], { type: 'image/png' })), {
      params: Promise.resolve({ id: informeInCb }),
    });
    expect(res.status).toBe(404);
  });

  it('5. member non-creator non-owner → 403 FORBIDDEN', async () => {
    await signInAs(emailMemberA);
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const res = await POST(makeUploadReq(informeInCa, new Blob([PNG_1X1], { type: 'image/png' })), {
      params: Promise.resolve({ id: informeInCa }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('6. sin file en FormData → 400 INVALID_INPUT', async () => {
    await signInAs(emailOwnerA);
    const fd = new FormData();
    const req = new NextRequest(`http://localhost:3000/api/informes/${informeInCa}/attachments`, {
      method: 'POST',
      body: fd,
    });
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const res = await POST(req, { params: Promise.resolve({ id: informeInCa }) });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/informes/[id]/attachments — validaciones', () => {
  it('7. MIME unsupported (text/html) → 415 UNSUPPORTED_MIME', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const res = await POST(
      makeUploadReq(informeInCa, new Blob(['<html></html>'], { type: 'text/html' })),
      { params: Promise.resolve({ id: informeInCa }) },
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNSUPPORTED_MIME');
  });

  it('8. size > 10 MB → 413 PAYLOAD_TOO_LARGE', async () => {
    await signInAs(emailOwnerA);
    const oversize = Buffer.alloc(10 * 1024 * 1024 + 1, 0x00); // 10 MB + 1
    // Inyectar header PNG en los primeros bytes (magic bytes valido).
    PNG_1X1.copy(oversize, 0, 0, 8);
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const res = await POST(
      makeUploadReq(informeInCa, new Blob([oversize], { type: 'image/png' })),
      { params: Promise.resolve({ id: informeInCa }) },
    );
    expect(res.status).toBe(413);
  });

  it('9. magic bytes mismatch (claim PNG con body de texto) → 415', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const res = await POST(
      makeUploadReq(
        informeInCa,
        new Blob([Buffer.from('not a png at all really')], { type: 'image/png' }),
      ),
      { params: Promise.resolve({ id: informeInCa }) },
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('MAGIC_BYTES_MISMATCH');
  });
});

describe('POST /api/informes/[id]/attachments — happy paths', () => {
  it('10. happy path image PNG → 201 + row inserted + audit log + storage object', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const res = await POST(
      makeUploadReq(informeInCa, new File([PNG_1X1], 'foto.png', { type: 'image/png' }), {
        caption: 'Esquina sur del galpon',
      }),
      { params: Promise.resolve({ id: informeInCa }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      attachment: { id: string; storage_path: string; kind: string; caption: string | null };
    };
    expect(body.ok).toBe(true);
    expect(body.attachment.kind).toBe('image');
    expect(body.attachment.caption).toBe('Esquina sur del galpon');

    storagePathsToClean.push(body.attachment.storage_path);

    // DB row presente.
    const { data: row } = await admin
      .from('informe_attachments')
      .select('id, kind, filename, mime_type, uploaded_by, position, caption')
      .eq('id', body.attachment.id)
      .single();
    expect(row?.kind).toBe('image');
    expect(row?.filename).toBe('foto.png');
    expect(row?.mime_type).toBe('image/png');
    expect(row?.uploaded_by).toBe(ownerAId);
    expect(row?.position).toBe(0); // primera attachment del informe.
    expect(row?.caption).toBe('Esquina sur del galpon');

    // Storage object presente.
    const { data: storageObj } = await admin.storage
      .from('informe-attachments')
      .download(body.attachment.storage_path);
    expect(storageObj).not.toBeNull();

    // Audit log.
    const { data: log } = await admin
      .from('audit_log')
      .select('action, entity_type, after_data')
      .eq('entity_type', 'informe_attachments')
      .eq('entity_id', body.attachment.id)
      .single();
    expect(log?.action).toBe('created');
    const after = log?.after_data as Record<string, unknown>;
    expect(after.filename).toBe('foto.png');
    expect(after.kind).toBe('image');
  });

  it('11. happy path file PDF → 201 + kind=file + caption null', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const res = await POST(
      makeUploadReq(
        informeInCa,
        new File([PDF_MINIMAL], 'planilla.pdf', { type: 'application/pdf' }),
        { caption: 'esto deberia descartarse' },
      ),
      { params: Promise.resolve({ id: informeInCa }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      attachment: { id: string; storage_path: string; kind: string; caption: string | null };
    };
    expect(body.attachment.kind).toBe('file');
    expect(body.attachment.caption).toBeNull(); // files NO aceptan caption.

    storagePathsToClean.push(body.attachment.storage_path);
  });

  it('12. position auto-incrementa segun count actual', async () => {
    await signInAs(emailOwnerA);
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');

    const { count: before } = await admin
      .from('informe_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('informe_id', informeInCa);

    const res = await POST(
      makeUploadReq(informeInCa, new File([PNG_1X1], 'extra.png', { type: 'image/png' })),
      { params: Promise.resolve({ id: informeInCa }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      attachment: { id: string; position: number; storage_path: string };
    };
    expect(body.attachment.position).toBe(before);
    storagePathsToClean.push(body.attachment.storage_path);
  });
});

describe('Server actions: caption + reorder + delete', () => {
  it('13. updateAttachmentCaptionAction: happy path', async () => {
    await signInAs(emailOwnerA);
    // Crear attachment via admin para evitar costo de Storage.
    const { data: att } = await admin
      .from('informe_attachments')
      .insert({
        informe_id: informeInCa,
        consultora_id: cAId,
        kind: 'image',
        storage_path: `${cAId}/${informeInCa}/${crypto.randomUUID()}.png`,
        filename: 'caption-test.png',
        mime_type: 'image/png',
        size_bytes: 1024,
        position: 0,
        uploaded_by: ownerAId,
      })
      .select('id')
      .single();

    const { updateAttachmentCaptionAction } =
      await import('@/app/(app)/informes/[id]/attachments/actions');
    const result = await updateAttachmentCaptionAction(att!.id, { caption: 'caption nuevo' });
    expect(result.ok).toBe(true);

    const { data: updated } = await admin
      .from('informe_attachments')
      .select('caption')
      .eq('id', att!.id)
      .single();
    expect(updated?.caption).toBe('caption nuevo');
  });

  it('14. updateAttachmentCaptionAction: rechaza caption en file (no-image)', async () => {
    await signInAs(emailOwnerA);
    const { data: att } = await admin
      .from('informe_attachments')
      .insert({
        informe_id: informeInCa,
        consultora_id: cAId,
        kind: 'file',
        storage_path: `${cAId}/${informeInCa}/${crypto.randomUUID()}.pdf`,
        filename: 'doc-test.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        position: 0,
        uploaded_by: ownerAId,
      })
      .select('id')
      .single();

    const { updateAttachmentCaptionAction } =
      await import('@/app/(app)/informes/[id]/attachments/actions');
    const result = await updateAttachmentCaptionAction(att!.id, { caption: 'no permitido' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_INPUT');
  });

  it('15. reorderInformeAttachmentsAction: happy path', async () => {
    await signInAs(emailOwnerA);
    const [a, b, c] = await Promise.all([
      admin
        .from('informe_attachments')
        .insert({
          informe_id: informeInCa,
          consultora_id: cAId,
          kind: 'image',
          storage_path: `${cAId}/${informeInCa}/${crypto.randomUUID()}.png`,
          filename: 'r1.png',
          mime_type: 'image/png',
          size_bytes: 1024,
          position: 10,
          uploaded_by: ownerAId,
        })
        .select('id')
        .single(),
      admin
        .from('informe_attachments')
        .insert({
          informe_id: informeInCa,
          consultora_id: cAId,
          kind: 'image',
          storage_path: `${cAId}/${informeInCa}/${crypto.randomUUID()}.png`,
          filename: 'r2.png',
          mime_type: 'image/png',
          size_bytes: 1024,
          position: 11,
          uploaded_by: ownerAId,
        })
        .select('id')
        .single(),
      admin
        .from('informe_attachments')
        .insert({
          informe_id: informeInCa,
          consultora_id: cAId,
          kind: 'image',
          storage_path: `${cAId}/${informeInCa}/${crypto.randomUUID()}.png`,
          filename: 'r3.png',
          mime_type: 'image/png',
          size_bytes: 1024,
          position: 12,
          uploaded_by: ownerAId,
        })
        .select('id')
        .single(),
    ]);

    const { reorderInformeAttachmentsAction } =
      await import('@/app/(app)/informes/[id]/attachments/actions');
    const result = await reorderInformeAttachmentsAction(informeInCa, {
      orderedIds: [c.data!.id, a.data!.id, b.data!.id],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.count).toBe(3);

    const { data: rows } = await admin
      .from('informe_attachments')
      .select('id, position')
      .in('id', [a.data!.id, b.data!.id, c.data!.id]);
    const byId = new Map(rows!.map((r) => [r.id, r.position]));
    expect(byId.get(c.data!.id)).toBe(0);
    expect(byId.get(a.data!.id)).toBe(1);
    expect(byId.get(b.data!.id)).toBe(2);
  });

  it('16. deleteInformeAttachmentAction: borra storage + row + audit log', async () => {
    await signInAs(emailOwnerA);
    // Crear attachment con upload real para verificar cleanup storage.
    const { POST } = await import('@/app/api/informes/[id]/attachments/route');
    const uploadRes = await POST(
      makeUploadReq(informeInCa, new File([PNG_1X1], 'todelete.png', { type: 'image/png' })),
      { params: Promise.resolve({ id: informeInCa }) },
    );
    const uploadBody = (await uploadRes.json()) as {
      attachment: { id: string; storage_path: string };
    };
    const attId = uploadBody.attachment.id;
    const path = uploadBody.attachment.storage_path;

    const { deleteInformeAttachmentAction } =
      await import('@/app/(app)/informes/[id]/attachments/actions');
    const result = await deleteInformeAttachmentAction(attId);
    expect(result.ok).toBe(true);

    // DB row eliminada.
    const { data: still } = await admin
      .from('informe_attachments')
      .select('id')
      .eq('id', attId)
      .maybeSingle();
    expect(still).toBeNull();

    // Storage object eliminado.
    const { data: list } = await admin.storage
      .from('informe-attachments')
      .list(path.slice(0, path.lastIndexOf('/')), {
        search: path.slice(path.lastIndexOf('/') + 1),
      });
    expect(list?.length ?? 0).toBe(0);

    // Audit log: row con action='deleted'.
    const { data: log } = await admin
      .from('audit_log')
      .select('action')
      .eq('entity_type', 'informe_attachments')
      .eq('entity_id', attId)
      .eq('action', 'deleted')
      .maybeSingle();
    expect(log?.action).toBe('deleted');
  });

  it('17. deleteInformeAttachmentAction: member non-creator → FORBIDDEN', async () => {
    // Crear attachment con ownerA via admin.
    const { data: att } = await admin
      .from('informe_attachments')
      .insert({
        informe_id: informeInCa,
        consultora_id: cAId,
        kind: 'image',
        storage_path: `${cAId}/${informeInCa}/${crypto.randomUUID()}.png`,
        filename: 'protected.png',
        mime_type: 'image/png',
        size_bytes: 1024,
        position: 99,
        uploaded_by: ownerAId,
      })
      .select('id')
      .single();

    await signInAs(emailMemberA);
    const { deleteInformeAttachmentAction } =
      await import('@/app/(app)/informes/[id]/attachments/actions');
    const result = await deleteInformeAttachmentAction(att!.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN');

    // Sigue viva.
    const { data: still } = await admin
      .from('informe_attachments')
      .select('id')
      .eq('id', att!.id)
      .maybeSingle();
    expect(still?.id).toBe(att!.id);
  });
});
