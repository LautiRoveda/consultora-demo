/**
 * T-024 · Tests cross-tenant + cascade de `public.informe_attachments`.
 *
 * Cobertura:
 * - RLS: SELECT/INSERT/UPDATE/DELETE policies (creator OR owner gate + uploaded_by = auth.uid()).
 * - ON DELETE CASCADE: borrar el informe parent borra las attachments rows.
 * - Audit trigger: row escrita en audit_log al INSERT/UPDATE/DELETE con shape esperado.
 *
 * No ejercita storage.objects — eso vive en informe-attachments-storage-rls.test.ts.
 * Aca rellenamos storage_path con strings unicos como fixtures (la columna NOT NULL
 * tiene check UNIQUE pero no valida que el objeto exista realmente en el bucket).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
const slugA = `t024-rls-a-${runId}`;
const slugB = `t024-rls-b-${runId}`;
const emailOwnerA = `t024-rls-owner-a-${runId}@example.com`;
const emailMemberA = `t024-rls-member-a-${runId}@example.com`;
const emailOwnerB = `t024-rls-owner-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let clientOwnerA: SupabaseClient<Database>;
let clientMemberA: SupabaseClient<Database>;
let clientOwnerB: SupabaseClient<Database>;

/** Informe en cA creado por ownerA. */
let informeInCa: string;
/** Attachment fixture insertado en beforeAll para tests de SELECT/UPDATE/DELETE. */
let attachmentFixtureId: string;

function makeStoragePath(consultoraId: string, informeId: string, suffix = 'png'): string {
  const uid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${consultoraId}/${informeId}/${uid}.${suffix}`;
}

beforeAll(async () => {
  // Consultoras.
  const [{ data: cA }, { data: cB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'T024 RLS cA', slug: slugA }).select('id').single(),
    admin.from('consultoras').insert({ name: 'T024 RLS cB', slug: slugB }).select('id').single(),
  ]);
  cAId = cA!.id;
  cBId = cB!.id;

  // Users.
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

  // Claim JWT (T-016 fast-path).
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  // Clientes anon con session firmada.
  const sbOA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbMA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbOB = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await Promise.all([
    sbOA.auth.signInWithPassword({ email: emailOwnerA, password }),
    sbMA.auth.signInWithPassword({ email: emailMemberA, password }),
    sbOB.auth.signInWithPassword({ email: emailOwnerB, password }),
  ]);
  clientOwnerA = sbOA;
  clientMemberA = sbMA;
  clientOwnerB = sbOB;

  // Informe parent (creator=ownerA, consultora=cA).
  const { data: i } = await admin
    .from('informes')
    .insert({
      consultora_id: cAId,
      tipo: 'rgrl',
      titulo: 'T024 RLS fixture',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  informeInCa = i!.id;

  // Attachment fixture (insertado via admin, uploaded_by=ownerA).
  const { data: a } = await admin
    .from('informe_attachments')
    .insert({
      informe_id: informeInCa,
      consultora_id: cAId,
      kind: 'image',
      storage_path: makeStoragePath(cAId, informeInCa),
      filename: 'fixture.png',
      mime_type: 'image/png',
      size_bytes: 1024,
      caption: 'fixture caption',
      position: 0,
      uploaded_by: ownerAId,
    })
    .select('id')
    .single();
  attachmentFixtureId = a!.id;
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
  ]);
});

describe('informe_attachments RLS', () => {
  it('1. SELECT bloqueado para user de otra consultora', async () => {
    const { data } = await clientOwnerB
      .from('informe_attachments')
      .select('id, filename')
      .eq('id', attachmentFixtureId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('2. SELECT permitido para member de la consultora', async () => {
    // memberA es member de cA (no creator del informe). Aun asi puede VER el attachment.
    const { data } = await clientMemberA
      .from('informe_attachments')
      .select('id, filename')
      .eq('id', attachmentFixtureId)
      .maybeSingle();
    expect(data?.id).toBe(attachmentFixtureId);
  });

  it('3. INSERT bloqueado para member non-creator non-owner', async () => {
    // memberA es member de cA pero NO creator del informe (ownerA lo es) y NO owner.
    const { error } = await clientMemberA.from('informe_attachments').insert({
      informe_id: informeInCa,
      consultora_id: cAId,
      kind: 'image',
      storage_path: makeStoragePath(cAId, informeInCa),
      filename: 'evil.png',
      mime_type: 'image/png',
      size_bytes: 1024,
      uploaded_by: memberAId,
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('4. INSERT permitido para creator del informe', async () => {
    const { data, error } = await clientOwnerA
      .from('informe_attachments')
      .insert({
        informe_id: informeInCa,
        consultora_id: cAId,
        kind: 'file',
        storage_path: makeStoragePath(cAId, informeInCa, 'pdf'),
        filename: 'doc.pdf',
        mime_type: 'application/pdf',
        size_bytes: 4096,
        uploaded_by: ownerAId,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it('5. INSERT bloqueado si uploaded_by != auth.uid() (usurpacion)', async () => {
    // ownerA intenta insertar con uploaded_by = ownerBId.
    const { error } = await clientOwnerA.from('informe_attachments').insert({
      informe_id: informeInCa,
      consultora_id: cAId,
      kind: 'image',
      storage_path: makeStoragePath(cAId, informeInCa),
      filename: 'spoof.png',
      mime_type: 'image/png',
      size_bytes: 1024,
      uploaded_by: ownerBId, // != auth.uid()
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('6. UPDATE bloqueado para user cross-tenant', async () => {
    const { data, error } = await clientOwnerB
      .from('informe_attachments')
      .update({ caption: 'hackeado' })
      .eq('id', attachmentFixtureId)
      .select('id');
    // RLS USING filtra → 0 filas afectadas, sin error.
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    // Verificar que el caption sigue siendo el original.
    const { data: still } = await admin
      .from('informe_attachments')
      .select('caption')
      .eq('id', attachmentFixtureId)
      .single();
    expect(still?.caption).toBe('fixture caption');
  });

  it('7. UPDATE permitido para creator (caption + position)', async () => {
    const { data, error } = await clientOwnerA
      .from('informe_attachments')
      .update({ caption: 'updated', position: 5 })
      .eq('id', attachmentFixtureId)
      .select('caption, position')
      .single();
    expect(error).toBeNull();
    expect(data?.caption).toBe('updated');
    expect(data?.position).toBe(5);
  });

  it('8. DELETE bloqueado para member non-creator non-owner', async () => {
    // Insertar un attachment por ownerA, intentar borrar como memberA.
    const { data: target } = await admin
      .from('informe_attachments')
      .insert({
        informe_id: informeInCa,
        consultora_id: cAId,
        kind: 'image',
        storage_path: makeStoragePath(cAId, informeInCa),
        filename: 'target.png',
        mime_type: 'image/png',
        size_bytes: 1024,
        uploaded_by: ownerAId,
      })
      .select('id')
      .single();

    const { data, error } = await clientMemberA
      .from('informe_attachments')
      .delete()
      .eq('id', target!.id)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    // Sigue ahi.
    const { data: still } = await admin
      .from('informe_attachments')
      .select('id')
      .eq('id', target!.id)
      .maybeSingle();
    expect(still?.id).toBe(target!.id);
  });

  it('9. DELETE permitido para creator', async () => {
    const { data: target } = await admin
      .from('informe_attachments')
      .insert({
        informe_id: informeInCa,
        consultora_id: cAId,
        kind: 'image',
        storage_path: makeStoragePath(cAId, informeInCa),
        filename: 'todelete.png',
        mime_type: 'image/png',
        size_bytes: 1024,
        uploaded_by: ownerAId,
      })
      .select('id')
      .single();

    const { data, error } = await clientOwnerA
      .from('informe_attachments')
      .delete()
      .eq('id', target!.id)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(1);
  });

  it('10. cascade: DELETE del informe parent borra todas las attachments', async () => {
    // Nuevo informe + 2 attachments.
    const { data: i } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'rgrl',
        titulo: 'T024 RLS cascade test',
        created_by: ownerAId,
      })
      .select('id')
      .single();
    const tmpInformeId = i!.id;

    await admin.from('informe_attachments').insert([
      {
        informe_id: tmpInformeId,
        consultora_id: cAId,
        kind: 'image',
        storage_path: makeStoragePath(cAId, tmpInformeId),
        filename: 'a.png',
        mime_type: 'image/png',
        size_bytes: 1024,
        uploaded_by: ownerAId,
      },
      {
        informe_id: tmpInformeId,
        consultora_id: cAId,
        kind: 'file',
        storage_path: makeStoragePath(cAId, tmpInformeId, 'pdf'),
        filename: 'b.pdf',
        mime_type: 'application/pdf',
        size_bytes: 2048,
        uploaded_by: ownerAId,
      },
    ]);

    const { count: before } = await admin
      .from('informe_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('informe_id', tmpInformeId);
    expect(before).toBe(2);

    await admin.from('informes').delete().eq('id', tmpInformeId);

    const { count: after } = await admin
      .from('informe_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('informe_id', tmpInformeId);
    expect(after).toBe(0);
  });

  it('11. audit_log: row escrita en INSERT con shape esperado', async () => {
    const { data: target } = await admin
      .from('informe_attachments')
      .insert({
        informe_id: informeInCa,
        consultora_id: cAId,
        kind: 'image',
        storage_path: makeStoragePath(cAId, informeInCa),
        filename: 'audit-test.png',
        mime_type: 'image/png',
        size_bytes: 2222,
        caption: 'audit',
        position: 9,
        uploaded_by: ownerAId,
      })
      .select('id')
      .single();

    const { data: log } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, before_data, after_data, consultora_id')
      .eq('entity_type', 'informe_attachments')
      .eq('entity_id', target!.id)
      .eq('action', 'created')
      .single();

    expect(log?.action).toBe('created');
    expect(log?.entity_type).toBe('informe_attachments');
    expect(log?.consultora_id).toBe(cAId);
    expect(log?.before_data).toBeNull();
    const after = log?.after_data as Record<string, unknown>;
    expect(after.kind).toBe('image');
    expect(after.filename).toBe('audit-test.png');
    expect(after.mime_type).toBe('image/png');
    expect(after.size_bytes).toBe(2222);
    expect(after.caption).toBe('audit');
    expect(after.position).toBe(9);
    expect(after.informe_id).toBe(informeInCa);
    // Defensivo: NO debe contener storage_path en el audit (no aporta auditoria).
    expect(after.storage_path).toBeUndefined();
  });

  it('12. audit_log: UPDATE escribe row con diff guard sobre (filename, caption, position)', async () => {
    const { data: target } = await admin
      .from('informe_attachments')
      .insert({
        informe_id: informeInCa,
        consultora_id: cAId,
        kind: 'image',
        storage_path: makeStoragePath(cAId, informeInCa),
        filename: 'audit-update.png',
        mime_type: 'image/png',
        size_bytes: 1024,
        position: 0,
        uploaded_by: ownerAId,
      })
      .select('id')
      .single();

    // Update position via service-role (bypasea RLS para mantener test enfocado en trigger).
    await admin.from('informe_attachments').update({ position: 3 }).eq('id', target!.id);

    const { data: updates } = await admin
      .from('audit_log')
      .select('before_data, after_data')
      .eq('entity_type', 'informe_attachments')
      .eq('entity_id', target!.id)
      .eq('action', 'updated');

    expect(updates?.length).toBe(1);
    const row = updates![0]!;
    const before = row.before_data as Record<string, unknown>;
    const after = row.after_data as Record<string, unknown>;
    expect(before.position).toBe(0);
    expect(after.position).toBe(3);
  });

  it('13. audit_log: UPDATE sin cambio en (filename, caption, position) NO escribe row', async () => {
    const { data: target } = await admin
      .from('informe_attachments')
      .insert({
        informe_id: informeInCa,
        consultora_id: cAId,
        kind: 'image',
        storage_path: makeStoragePath(cAId, informeInCa),
        filename: 'audit-noop.png',
        mime_type: 'image/png',
        size_bytes: 1024,
        position: 7,
        uploaded_by: ownerAId,
      })
      .select('id')
      .single();

    // Update que solo toca updated_at (campos no-tracked en el guard).
    // Como las otras columnas son inmutables post-insert via UI, simulamos
    // re-asignando los mismos valores.
    await admin
      .from('informe_attachments')
      .update({ filename: 'audit-noop.png', position: 7 })
      .eq('id', target!.id);

    const { data: updates } = await admin
      .from('audit_log')
      .select('id')
      .eq('entity_type', 'informe_attachments')
      .eq('entity_id', target!.id)
      .eq('action', 'updated');
    expect(updates?.length ?? 0).toBe(0);
  });
});
