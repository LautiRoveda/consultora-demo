/**
 * T-059 · Tests de integration de las server actions nuevas del módulo Checklists:
 * reorder (secciones/ítems) + restore + updateMeta.
 *
 * Cobertura:
 *  - reorderSectionsAction: happy (reverse = caso unique-mid-swap) + rotación +
 *    INVALID_ORDER_SET (subset / id ajeno) + VERSION_NOT_DRAFT (post-publish) +
 *    cross-tenant NOT_FOUND + non-owner FORBIDDEN_NOT_OWNER.
 *  - reorderItemsAction: happy (reverse) + INVALID_ORDER_SET.
 *  - restoreTemplateAction: happy + ALREADY_ACTIVE + DUPLICATE_NAME (nombre reusado).
 *  - updateTemplateMetaAction: happy patch parcial + DUPLICATE_NAME + system NOT_FOUND.
 *
 * El caso clave del reorder es el unique-mid-swap: (version_id|section_id, orden) es
 * UNIQUE non-deferrable; revertir el orden choca un swap naive pero la RPC two-phase
 * (bump +1000000 → 0..N-1) lo resuelve.
 *
 * Setup SECUENCIAL (lesson T-047 — Promise.all sa-east-1 flaky).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestConsultora } from './helpers/consultora';

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

const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerInfoMock = vi.fn();
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: () => {},
    debug: () => {},
    info: (arg: unknown, msg?: string) => loggerInfoMock(arg, msg),
    warn: (arg: unknown, msg?: string) => loggerWarnMock(arg, msg),
    error: (arg: unknown, msg?: string) => loggerErrorMock(arg, msg),
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

const slugA = `t059a-${runId}`;
const slugB = `t059b-${runId}`;
const emailOwnerA = `t059a-own-${runId}@example.com`;
const emailMemberA = `t059a-mem-${runId}@example.com`;
const emailOwnerB = `t059b-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;

beforeAll(async () => {
  // Setup SECUENCIAL — lesson T-047 (Promise.all flaky sa-east-1).
  const cA = await createTestConsultora(admin, { name: 'T059A', slug: slugA });
  cAId = cA.id;

  const cB = await createTestConsultora(admin, { name: 'T059B', slug: slugB });
  cBId = cB.id;

  const { data: uOA, error: errUOA } = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  expect(errUOA).toBeNull();
  ownerAId = uOA.user!.id;

  const { data: uMA, error: errUMA } = await admin.auth.admin.createUser({
    email: emailMemberA,
    password,
    email_confirm: true,
  });
  expect(errUMA).toBeNull();
  memberAId = uMA.user!.id;

  const { data: uOB, error: errUOB } = await admin.auth.admin.createUser({
    email: emailOwnerB,
    password,
    email_confirm: true,
  });
  expect(errUOB).toBeNull();
  ownerBId = uOB.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(memberAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
});

beforeEach(() => {
  cookieStore.length = 0;
  loggerWarnMock.mockClear();
  loggerErrorMock.mockClear();
  loggerInfoMock.mockClear();
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

type ChecklistActions = typeof import('@/app/(app)/checklists/actions');
async function importActions(): Promise<ChecklistActions> {
  return import('@/app/(app)/checklists/actions');
}

let nameCounter = 0;
function uniqueName(prefix: string): string {
  nameCounter += 1;
  return `${prefix}-${runId}-${nameCounter}`;
}

/** Crea (como owner A, ya signed-in) un template draft con N secciones × M ítems. */
async function createTemplateWithStructure(
  nombre: string,
  opts: { sections?: number; itemsPerSection?: number } = {},
): Promise<{ templateId: string; versionId: string; sectionIds: string[] }> {
  const actions = await importActions();
  const created = await actions.createChecklistTemplateAction({
    nombre,
    tipo_inspeccion: 'generico',
  });
  if (!created.ok) throw new Error(`create falló: ${JSON.stringify(created)}`);

  const nSections = opts.sections ?? 3;
  const nItems = opts.itemsPerSection ?? 2;
  const sectionIds: string[] = [];
  for (let s = 0; s < nSections; s += 1) {
    const sec = await actions.addSectionAction({
      versionId: created.versionId,
      titulo: `Sección ${s + 1}`,
    });
    if (!sec.ok) throw new Error(`addSection falló: ${JSON.stringify(sec)}`);
    sectionIds.push(sec.sectionId);
    for (let i = 0; i < nItems; i += 1) {
      const it = await actions.addItemAction({
        sectionId: sec.sectionId,
        texto: `Ítem ${s + 1}.${i + 1}`,
      });
      if (!it.ok) throw new Error(`addItem falló: ${JSON.stringify(it)}`);
    }
  }
  return { templateId: created.templateId, versionId: created.versionId, sectionIds };
}

async function currentSectionIds(versionId: string): Promise<string[]> {
  const { data } = await admin
    .from('template_sections')
    .select('id, orden')
    .eq('version_id', versionId)
    .order('orden', { ascending: true });
  return (data ?? []).map((s) => s.id);
}

async function currentItemIds(sectionId: string): Promise<string[]> {
  const { data } = await admin
    .from('template_items')
    .select('id, orden')
    .eq('section_id', sectionId)
    .order('orden', { ascending: true });
  return (data ?? []).map((i) => i.id);
}

const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('reorderSectionsAction', () => {
  it('1. happy reverse (caso unique-mid-swap): orden queda 0..N-1 = array enviado', async () => {
    await signInAs(emailOwnerA);
    const { versionId } = await createTemplateWithStructure(uniqueName('reorder-rev'));
    const ids = await currentSectionIds(versionId);
    expect(ids.length).toBe(3);

    const reversed = [...ids].reverse();
    const actions = await importActions();
    const r = await actions.reorderSectionsAction({ versionId, orderedIds: reversed });
    expect(r.ok).toBe(true);

    expect(await currentSectionIds(versionId)).toEqual(reversed);
  });

  it('2. happy rotación [A,B,C]→[C,A,B]', async () => {
    await signInAs(emailOwnerA);
    const { versionId } = await createTemplateWithStructure(uniqueName('reorder-rot'));
    const [a, b, c] = await currentSectionIds(versionId);
    const rotated = [c, a, b];

    const actions = await importActions();
    const r = await actions.reorderSectionsAction({ versionId, orderedIds: rotated });
    expect(r.ok).toBe(true);
    expect(await currentSectionIds(versionId)).toEqual(rotated);
  });

  it('3. INVALID_ORDER_SET: subset (falta una sección)', async () => {
    await signInAs(emailOwnerA);
    const { versionId } = await createTemplateWithStructure(uniqueName('reorder-subset'));
    const ids = await currentSectionIds(versionId);

    const actions = await importActions();
    const r = await actions.reorderSectionsAction({ versionId, orderedIds: ids.slice(0, 2) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_ORDER_SET');
    // El orden no cambió.
    expect(await currentSectionIds(versionId)).toEqual(ids);
  });

  it('4. INVALID_ORDER_SET: id ajeno en el array', async () => {
    await signInAs(emailOwnerA);
    const { versionId } = await createTemplateWithStructure(uniqueName('reorder-foreign'));
    const ids = await currentSectionIds(versionId);

    const actions = await importActions();
    const r = await actions.reorderSectionsAction({
      versionId,
      orderedIds: [...ids, FAKE_UUID],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_ORDER_SET');
  });

  it('5. VERSION_NOT_DRAFT: reorder de una versión publicada', async () => {
    await signInAs(emailOwnerA);
    const { versionId } = await createTemplateWithStructure(uniqueName('reorder-pub'));
    const ids = await currentSectionIds(versionId);

    const actions = await importActions();
    const pub = await actions.publishVersionAction({ versionId });
    expect(pub.ok).toBe(true);

    const r = await actions.reorderSectionsAction({ versionId, orderedIds: [...ids].reverse() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('VERSION_NOT_DRAFT');
  });

  it('6. cross-tenant NOT_FOUND: owner B reordena una versión de A', async () => {
    await signInAs(emailOwnerA);
    const { versionId } = await createTemplateWithStructure(uniqueName('reorder-xtenant'));

    await signInAs(emailOwnerB);
    const actions = await importActions();
    const r = await actions.reorderSectionsAction({ versionId, orderedIds: [FAKE_UUID] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NOT_FOUND');
  });

  it('7. non-owner FORBIDDEN_NOT_OWNER: member A reordena un draft de A', async () => {
    await signInAs(emailOwnerA);
    const { versionId } = await createTemplateWithStructure(uniqueName('reorder-member'));
    const ids = await currentSectionIds(versionId);

    await signInAs(emailMemberA);
    const actions = await importActions();
    const r = await actions.reorderSectionsAction({ versionId, orderedIds: [...ids].reverse() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('FORBIDDEN_NOT_OWNER');
  });
});

describe('reorderItemsAction', () => {
  it('8. happy reverse de ítems dentro de una sección', async () => {
    await signInAs(emailOwnerA);
    const { sectionIds } = await createTemplateWithStructure(uniqueName('reorder-items'), {
      sections: 1,
      itemsPerSection: 3,
    });
    const sectionId = sectionIds[0]!;
    const ids = await currentItemIds(sectionId);
    expect(ids.length).toBe(3);

    const reversed = [...ids].reverse();
    const actions = await importActions();
    const r = await actions.reorderItemsAction({ sectionId, orderedIds: reversed });
    expect(r.ok).toBe(true);
    expect(await currentItemIds(sectionId)).toEqual(reversed);
  });

  it('9. INVALID_ORDER_SET en ítems: id ajeno', async () => {
    await signInAs(emailOwnerA);
    const { sectionIds } = await createTemplateWithStructure(uniqueName('reorder-items-bad'), {
      sections: 1,
      itemsPerSection: 2,
    });
    const sectionId = sectionIds[0]!;
    const ids = await currentItemIds(sectionId);

    const actions = await importActions();
    const r = await actions.reorderItemsAction({ sectionId, orderedIds: [ids[0]!, FAKE_UUID] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_ORDER_SET');
  });
});

describe('restoreTemplateAction', () => {
  it('10. happy: desarchiva → archived_at vuelve a null', async () => {
    await signInAs(emailOwnerA);
    const { templateId } = await createTemplateWithStructure(uniqueName('restore-ok'), {
      sections: 1,
      itemsPerSection: 1,
    });
    await admin
      .from('checklist_templates')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', templateId);

    const actions = await importActions();
    const r = await actions.restoreTemplateAction({ templateId });
    expect(r.ok).toBe(true);

    const { data } = await admin
      .from('checklist_templates')
      .select('archived_at')
      .eq('id', templateId)
      .single();
    expect(data?.archived_at).toBeNull();
  });

  it('11. ALREADY_ACTIVE: restaurar un template activo', async () => {
    await signInAs(emailOwnerA);
    const { templateId } = await createTemplateWithStructure(uniqueName('restore-active'), {
      sections: 1,
      itemsPerSection: 1,
    });

    const actions = await importActions();
    const r = await actions.restoreTemplateAction({ templateId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('ALREADY_ACTIVE');
  });

  it('12. DUPLICATE_NAME: nombre reusado por otro activo mientras estaba archivado', async () => {
    await signInAs(emailOwnerA);
    const nombre = uniqueName('restore-dup');
    const actions = await importActions();

    // t1 activo → archivar.
    const first = await createTemplateWithStructure(nombre, { sections: 1, itemsPerSection: 1 });
    await admin
      .from('checklist_templates')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', first.templateId);

    // t2 activo con el MISMO nombre (permitido: índice parcial WHERE archived_at IS NULL).
    const second = await actions.createChecklistTemplateAction({
      nombre,
      tipo_inspeccion: 'generico',
    });
    expect(second.ok).toBe(true);

    // restaurar t1 → choca con t2 activo → DUPLICATE_NAME.
    const r = await actions.restoreTemplateAction({ templateId: first.templateId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DUPLICATE_NAME');
    if (r.code !== 'DUPLICATE_NAME') return;
    expect(r.fieldErrors.nombre.length).toBeGreaterThan(0);
  });
});

describe('updateTemplateMetaAction', () => {
  it('13. happy: patch parcial nombre + descripcion', async () => {
    await signInAs(emailOwnerA);
    const { templateId } = await createTemplateWithStructure(uniqueName('meta-ok'), {
      sections: 1,
      itemsPerSection: 1,
    });
    const nuevoNombre = uniqueName('meta-renamed');

    const actions = await importActions();
    const r = await actions.updateTemplateMetaAction({
      templateId,
      nombre: nuevoNombre,
      descripcion: 'Descripción nueva',
    });
    expect(r.ok).toBe(true);

    const { data } = await admin
      .from('checklist_templates')
      .select('nombre, descripcion, tipo_inspeccion')
      .eq('id', templateId)
      .single();
    expect(data).toMatchObject({
      nombre: nuevoNombre,
      descripcion: 'Descripción nueva',
      tipo_inspeccion: 'generico', // intacto, no estaba en el patch
    });
  });

  it('14. DUPLICATE_NAME: renombrar a un nombre activo existente', async () => {
    await signInAs(emailOwnerA);
    const actions = await importActions();
    const nombreA = uniqueName('meta-dupA');
    const t1 = await createTemplateWithStructure(nombreA, { sections: 1, itemsPerSection: 1 });
    const t2 = await createTemplateWithStructure(uniqueName('meta-dupB'), {
      sections: 1,
      itemsPerSection: 1,
    });

    const r = await actions.updateTemplateMetaAction({
      templateId: t2.templateId,
      nombre: nombreA,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DUPLICATE_NAME');
    // t1 intacto.
    const { data } = await admin
      .from('checklist_templates')
      .select('nombre')
      .eq('id', t1.templateId)
      .single();
    expect(data?.nombre).toBe(nombreA);
  });

  it('15. system NOT_FOUND: no se puede editar un template de sistema', async () => {
    const { data: sys } = await admin
      .from('checklist_templates')
      .select('id')
      .is('consultora_id', null)
      .limit(1)
      .maybeSingle();
    expect(sys?.id).toBeTruthy();
    if (!sys?.id) return;

    await signInAs(emailOwnerA);
    const actions = await importActions();
    const r = await actions.updateTemplateMetaAction({
      templateId: sys.id,
      nombre: uniqueName('hack'),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NOT_FOUND');
  });
});
