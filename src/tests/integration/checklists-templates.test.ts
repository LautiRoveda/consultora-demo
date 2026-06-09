/**
 * T-058 · Integration tests del backend de templates de Checklists.
 *
 * Cobertura:
 *  - createChecklistTemplateAction: owner happy (+ versión 1 draft) / FORBIDDEN /
 *    UNAUTHENTICATED / DUPLICATE_NAME / INVALID_INPUT / BILLING_GATED.
 *  - structure ops granulares (add/update/delete section+item): happy en draft,
 *    NOT_FOUND, VERSION_NOT_DRAFT (sobre versión publicada), FORBIDDEN, cross-tenant.
 *  - publishVersionAction: VERSION_EMPTY / happy (congela) / VERSION_NOT_DRAFT.
 *  - editPublishedTemplateAction: clona a draft sin tocar la publicada / ≤1 draft
 *    (DRAFT_ALREADY_EXISTS) / sistema → NOT_FOUND.
 *  - cloneSystemTemplateAction: clona estructura de sistema / múltiples (auto-suffix) /
 *    DUPLICATE_NAME (override) / NOT_FOUND / FORBIDDEN.
 *  - archiveTemplateAction: happy / ALREADY_ARCHIVED / sistema → NOT_FOUND.
 *  - RLS cruda: sistema read-only para authenticated; cross-tenant negado.
 *
 * Setup secuencial (lesson T-047 Promise.all flaky). Corre contra Supabase local
 * (`pnpm test:integration`, T-111) — requiere Docker.
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
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  },
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

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';

const slugA = `t058a-${runId}`;
const slugB = `t058b-${runId}`;
const slugExp = `t058exp-${runId}`;
const emailOwnerA = `t058a-own-${runId}@example.com`;
const emailMemberA = `t058a-mem-${runId}@example.com`;
const emailOwnerB = `t058b-own-${runId}@example.com`;
const emailOwnerExp = `t058exp-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let cExpId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let ownerExpId: string;
let systemTemplateId: string;

let nameCounter = 0;
function nextName(prefix: string): string {
  nameCounter += 1;
  return `${prefix}-${runId}-${nameCounter}`;
}

async function mkUser(email: string): Promise<string> {
  const u = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (u.error || !u.data.user) throw new Error(`createUser ${email}: ${JSON.stringify(u.error)}`);
  return u.data.user.id;
}

beforeAll(async () => {
  const cA = await createTestConsultora(admin, { name: 'T058A', slug: slugA });
  cAId = cA.id;
  const cB = await createTestConsultora(admin, { name: 'T058B', slug: slugB });
  cBId = cB.id;
  // Trial vencido → gate de billing.
  const cExp = await createTestConsultora(admin, {
    name: 'T058Exp',
    slug: slugExp,
    plan: 'trial',
    trialHasta: new Date(Date.now() - 86_400_000).toISOString(),
  });
  cExpId = cExp.id;

  ownerAId = await mkUser(emailOwnerA);
  memberAId = await mkUser(emailMemberA);
  ownerBId = await mkUser(emailOwnerB);
  ownerExpId = await mkUser(emailOwnerExp);

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
    { user_id: ownerExpId, consultora_id: cExpId, role: 'owner' },
  ]);

  await admin.auth.admin.updateUserById(ownerAId, {
    app_metadata: { consultora_id: cAId, consultora_role: 'owner' },
  });
  await admin.auth.admin.updateUserById(memberAId, {
    app_metadata: { consultora_id: cAId, consultora_role: 'member' },
  });
  await admin.auth.admin.updateUserById(ownerBId, {
    app_metadata: { consultora_id: cBId, consultora_role: 'owner' },
  });
  await admin.auth.admin.updateUserById(ownerExpId, {
    app_metadata: { consultora_id: cExpId, consultora_role: 'owner' },
  });

  // Template de sistema RGRL seedeado por la migración T-057.
  const { data: sys } = await admin
    .from('checklist_templates')
    .select('id')
    .is('consultora_id', null)
    .eq('tipo_inspeccion', 'rgrl_463_09')
    .limit(1)
    .maybeSingle();
  if (!sys) throw new Error('No se encontró el template de sistema RGRL (seed T-057).');
  systemTemplateId = sys.id;
});

afterAll(async () => {
  // checklist_templates cascada a versions/sections/items por consultora_id.
  await admin.from('checklist_templates').delete().in('consultora_id', [cAId, cBId, cExpId]);
  await admin.from('consultora_members').delete().in('consultora_id', [cAId, cBId, cExpId]);
  await admin.from('consultoras').delete().in('id', [cAId, cBId, cExpId]);
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(memberAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerExpId).catch(() => {});
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

type Actions = typeof import('@/app/(app)/checklists/actions');
function actions(): Promise<Actions> {
  return import('@/app/(app)/checklists/actions');
}

/** Crea un template (draft v1) como ownerA y devuelve {templateId, versionId}. */
async function createDraft(name: string): Promise<{ templateId: string; versionId: string }> {
  await signInAs(emailOwnerA);
  const { createChecklistTemplateAction } = await actions();
  const r = await createChecklistTemplateAction({ nombre: name });
  if (!r.ok) throw new Error(`createDraft setup failed: ${JSON.stringify(r)}`);
  return { templateId: r.templateId, versionId: r.versionId };
}

async function countStructure(versionId: string): Promise<{ sections: number; items: number }> {
  const { count: sections } = await admin
    .from('template_sections')
    .select('id', { count: 'exact', head: true })
    .eq('version_id', versionId);
  const { count: items } = await admin
    .from('template_items')
    .select('id', { count: 'exact', head: true })
    .eq('version_id', versionId);
  return { sections: sections ?? 0, items: items ?? 0 };
}

// ============================== createChecklistTemplate ==============================

describe('createChecklistTemplateAction', () => {
  it('1. owner crea template + versión 1 draft', async () => {
    await signInAs(emailOwnerA);
    const { createChecklistTemplateAction } = await actions();
    const nombre = nextName('Tpl');
    const r = await createChecklistTemplateAction({ nombre, descripcion: 'desc' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { data: tpl } = await admin
      .from('checklist_templates')
      .select('consultora_id, created_by, tipo_inspeccion, archived_at')
      .eq('id', r.templateId)
      .single();
    expect(tpl).toMatchObject({
      consultora_id: cAId,
      created_by: ownerAId,
      tipo_inspeccion: 'rgrl_463_09',
      archived_at: null,
    });

    const { data: ver } = await admin
      .from('checklist_template_versions')
      .select('version_number, estado, consultora_id, created_by')
      .eq('id', r.versionId)
      .single();
    expect(ver).toMatchObject({
      version_number: 1,
      estado: 'draft',
      consultora_id: cAId,
      created_by: ownerAId,
    });
  });

  it('2. member non-owner → FORBIDDEN_NOT_OWNER', async () => {
    await signInAs(emailMemberA);
    const { createChecklistTemplateAction } = await actions();
    const r = await createChecklistTemplateAction({ nombre: nextName('TplM') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FORBIDDEN_NOT_OWNER');
  });

  it('3. sin sesión → UNAUTHENTICATED', async () => {
    cookieStore.length = 0;
    const { createChecklistTemplateAction } = await actions();
    const r = await createChecklistTemplateAction({ nombre: nextName('TplU') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('UNAUTHENTICATED');
  });

  it('4. nombre duplicado activo → DUPLICATE_NAME', async () => {
    await signInAs(emailOwnerA);
    const { createChecklistTemplateAction } = await actions();
    const nombre = nextName('TplDup');
    const r1 = await createChecklistTemplateAction({ nombre });
    expect(r1.ok).toBe(true);
    const r2 = await createChecklistTemplateAction({ nombre });
    expect(r2.ok).toBe(false);
    if (!r2.ok && r2.code === 'DUPLICATE_NAME') {
      expect(r2.fieldErrors.nombre.length).toBeGreaterThan(0);
    } else {
      throw new Error(`esperaba DUPLICATE_NAME, got ${JSON.stringify(r2)}`);
    }
  });

  it('5. nombre vacío → INVALID_INPUT', async () => {
    await signInAs(emailOwnerA);
    const { createChecklistTemplateAction } = await actions();
    const r = await createChecklistTemplateAction({ nombre: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT');
  });

  it('6. trial vencido → BILLING_GATED', async () => {
    await signInAs(emailOwnerExp);
    const { createChecklistTemplateAction } = await actions();
    const r = await createChecklistTemplateAction({ nombre: nextName('TplExp') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BILLING_GATED');
  });
});

// ============================== Structure ops ==============================

describe('structure ops (granulares)', () => {
  it('7. addSection + addItem happy (append orden, consultora_id=tenant)', async () => {
    const { versionId } = await createDraft(nextName('TplStruct'));
    const { addSectionAction, addItemAction } = await actions();

    const s = await addSectionAction({ versionId, titulo: 'Servicio HyS' });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const i = await addItemAction({ sectionId: s.sectionId, texto: '¿Cumple?' });
    expect(i.ok).toBe(true);
    if (!i.ok) return;

    const { data: section } = await admin
      .from('template_sections')
      .select('version_id, consultora_id, orden')
      .eq('id', s.sectionId)
      .single();
    expect(section).toMatchObject({ version_id: versionId, consultora_id: cAId, orden: 0 });

    const { data: item } = await admin
      .from('template_items')
      .select('section_id, version_id, consultora_id, orden, response_type')
      .eq('id', i.itemId)
      .single();
    expect(item).toMatchObject({
      section_id: s.sectionId,
      version_id: versionId,
      consultora_id: cAId,
      orden: 0,
      response_type: 'cumple_no_aplica',
    });

    // Segunda sección → orden 1 (append).
    const s2 = await addSectionAction({ versionId, titulo: 'Otra' });
    expect(s2.ok).toBe(true);
    if (s2.ok) {
      const { data: sec2 } = await admin
        .from('template_sections')
        .select('orden')
        .eq('id', s2.sectionId)
        .single();
      expect(sec2?.orden).toBe(1);
    }
  });

  it('8. addSection a versionId inexistente → NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { addSectionAction } = await actions();
    const r = await addSectionAction({
      versionId: '123e4567-e89b-42d3-a456-426614174000',
      titulo: 'X',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });

  it('9. update + delete section/item happy', async () => {
    const { versionId } = await createDraft(nextName('TplEdit'));
    const {
      addSectionAction,
      addItemAction,
      updateSectionAction,
      updateItemAction,
      deleteItemAction,
      deleteSectionAction,
    } = await actions();
    const s = await addSectionAction({ versionId, titulo: 'Sec' });
    if (!s.ok) throw new Error('setup');
    const i = await addItemAction({ sectionId: s.sectionId, texto: 'Item' });
    if (!i.ok) throw new Error('setup');

    expect((await updateSectionAction({ sectionId: s.sectionId, titulo: 'Sec v2' })).ok).toBe(true);
    expect((await updateItemAction({ itemId: i.itemId, es_critico: true })).ok).toBe(true);
    const { data: it } = await admin
      .from('template_items')
      .select('es_critico')
      .eq('id', i.itemId)
      .single();
    expect(it?.es_critico).toBe(true);

    expect((await deleteItemAction({ itemId: i.itemId })).ok).toBe(true);
    expect((await deleteSectionAction({ sectionId: s.sectionId })).ok).toBe(true);
  });

  it('10. member non-owner addSection → FORBIDDEN_NOT_OWNER', async () => {
    const { versionId } = await createDraft(nextName('TplMemberGate'));
    await signInAs(emailMemberA);
    const { addSectionAction } = await actions();
    const r = await addSectionAction({ versionId, titulo: 'X' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FORBIDDEN_NOT_OWNER');
  });
});

// ============================== publish + freeze ==============================

describe('publishVersionAction', () => {
  it('11. versión sin ítems → VERSION_EMPTY', async () => {
    const { versionId } = await createDraft(nextName('TplEmpty'));
    const { publishVersionAction } = await actions();
    const r = await publishVersionAction({ versionId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VERSION_EMPTY');
  });

  it('12. con ≥1 ítem → publica y congela (estado=published, published_by)', async () => {
    const { versionId } = await createDraft(nextName('TplPub'));
    const { addSectionAction, addItemAction, publishVersionAction } = await actions();
    const s = await addSectionAction({ versionId, titulo: 'Sec' });
    if (!s.ok) throw new Error('setup');
    const i = await addItemAction({ sectionId: s.sectionId, texto: 'Item' });
    if (!i.ok) throw new Error('setup');

    const r = await publishVersionAction({ versionId });
    expect(r.ok).toBe(true);

    const { data: ver } = await admin
      .from('checklist_template_versions')
      .select('estado, published_by, published_at')
      .eq('id', versionId)
      .single();
    expect(ver?.estado).toBe('published');
    expect(ver?.published_by).toBe(ownerAId);
    expect(ver?.published_at).not.toBeNull();

    // Freeze: addSection sobre la versión publicada → VERSION_NOT_DRAFT.
    const frozen = await addSectionAction({ versionId, titulo: 'Tarde' });
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.code).toBe('VERSION_NOT_DRAFT');

    // Re-publicar → VERSION_NOT_DRAFT.
    const again = await publishVersionAction({ versionId });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('VERSION_NOT_DRAFT');
  });
});

// ============================== editPublished (clone-to-draft) ==============================

describe('editPublishedTemplateAction', () => {
  it('13. clona la publicada a un draft nuevo sin tocarla + ≤1 draft', async () => {
    const { templateId, versionId: v1 } = await createDraft(nextName('TplClone'));
    const { addSectionAction, addItemAction, publishVersionAction, editPublishedTemplateAction } =
      await actions();
    const s = await addSectionAction({ versionId: v1, titulo: 'Sec' });
    if (!s.ok) throw new Error('setup');
    const i = await addItemAction({ sectionId: s.sectionId, texto: 'Item' });
    if (!i.ok) throw new Error('setup');
    expect((await publishVersionAction({ versionId: v1 })).ok).toBe(true);

    const r = await editPublishedTemplateAction({ templateId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.versionId).not.toBe(v1);

    const { data: v2row } = await admin
      .from('checklist_template_versions')
      .select('version_number, estado')
      .eq('id', r.versionId)
      .single();
    expect(v2row).toMatchObject({ version_number: 2, estado: 'draft' });

    // Estructura copiada (mismos counts, ids nuevos).
    const c1 = await countStructure(v1);
    const c2 = await countStructure(r.versionId);
    expect(c2).toEqual(c1);
    const { data: v2Sections } = await admin
      .from('template_sections')
      .select('id, orden')
      .eq('version_id', r.versionId);
    expect(v2Sections?.[0]?.id).not.toBe(s.sectionId);
    expect(v2Sections?.[0]?.orden).toBe(0); // orden preservado

    // La publicada quedó intacta.
    expect((await countStructure(v1)).items).toBe(c1.items);

    // ≤1 draft: segundo editPublished → DRAFT_ALREADY_EXISTS con el mismo versionId.
    const r2 = await editPublishedTemplateAction({ templateId });
    expect(r2.ok).toBe(false);
    if (!r2.ok && r2.code === 'DRAFT_ALREADY_EXISTS') {
      expect(r2.versionId).toBe(r.versionId);
    } else {
      throw new Error(`esperaba DRAFT_ALREADY_EXISTS, got ${JSON.stringify(r2)}`);
    }
  });

  it('14. editPublished sobre template de sistema → NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { editPublishedTemplateAction } = await actions();
    const r = await editPublishedTemplateAction({ templateId: systemTemplateId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });
});

// ============================== cloneSystemTemplate ==============================

describe('cloneSystemTemplateAction', () => {
  it('15. clona el RGRL de sistema a un draft del tenant (estructura copiada)', async () => {
    await signInAs(emailOwnerA);
    const { cloneSystemTemplateAction } = await actions();
    const r = await cloneSystemTemplateAction({ systemTemplateId, nombre: nextName('RGRLClone') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { data: tpl } = await admin
      .from('checklist_templates')
      .select('consultora_id')
      .eq('id', r.templateId)
      .single();
    expect(tpl?.consultora_id).toBe(cAId);

    const { data: ver } = await admin
      .from('checklist_template_versions')
      .select('version_number, estado, consultora_id')
      .eq('id', r.versionId)
      .single();
    expect(ver).toMatchObject({ version_number: 1, estado: 'draft', consultora_id: cAId });

    // Estructura del sistema (1 sección + 8 ítems en el seed) copiada bajo el tenant.
    const { data: sysVer } = await admin
      .from('checklist_template_versions')
      .select('id')
      .eq('template_id', systemTemplateId)
      .eq('estado', 'published')
      .order('version_number', { ascending: false })
      .limit(1)
      .single();
    const sysCounts = await countStructure(sysVer!.id);
    const cloneCounts = await countStructure(r.versionId);
    expect(cloneCounts).toEqual(sysCounts);

    const { data: items } = await admin
      .from('template_items')
      .select('consultora_id')
      .eq('version_id', r.versionId)
      .limit(1);
    expect(items?.[0]?.consultora_id).toBe(cAId);
  });

  it('16. clones múltiples sin nombre → auto-suffix (permite variantes)', async () => {
    await signInAs(emailOwnerA);
    const { cloneSystemTemplateAction } = await actions();
    const r1 = await cloneSystemTemplateAction({ systemTemplateId });
    const r2 = await cloneSystemTemplateAction({ systemTemplateId });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.templateId).not.toBe(r2.templateId);
  });

  it('17. override de nombre que colisiona → DUPLICATE_NAME', async () => {
    await signInAs(emailOwnerA);
    const { createChecklistTemplateAction, cloneSystemTemplateAction } = await actions();
    const nombre = nextName('CollideClone');
    expect((await createChecklistTemplateAction({ nombre })).ok).toBe(true);
    const r = await cloneSystemTemplateAction({ systemTemplateId, nombre });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DUPLICATE_NAME');
  });

  it('18. systemTemplateId inexistente → NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { cloneSystemTemplateAction } = await actions();
    const r = await cloneSystemTemplateAction({
      systemTemplateId: '123e4567-e89b-42d3-a456-426614174000',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });

  it('19. member non-owner → FORBIDDEN_NOT_OWNER', async () => {
    await signInAs(emailMemberA);
    const { cloneSystemTemplateAction } = await actions();
    const r = await cloneSystemTemplateAction({ systemTemplateId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FORBIDDEN_NOT_OWNER');
  });
});

// ============================== archiveTemplate ==============================

describe('archiveTemplateAction', () => {
  it('20. archive happy + ALREADY_ARCHIVED', async () => {
    const { templateId } = await createDraft(nextName('TplArch'));
    const { archiveTemplateAction } = await actions();
    const r1 = await archiveTemplateAction({ templateId });
    expect(r1.ok).toBe(true);
    const { data } = await admin
      .from('checklist_templates')
      .select('archived_at')
      .eq('id', templateId)
      .single();
    expect(data?.archived_at).not.toBeNull();

    const r2 = await archiveTemplateAction({ templateId });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('ALREADY_ARCHIVED');
  });

  it('21. archive de sistema → NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { archiveTemplateAction } = await actions();
    const r = await archiveTemplateAction({ templateId: systemTemplateId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });
});

// ============================== RLS cruda ==============================

describe('RLS', () => {
  it('22. authenticated VE el template de sistema pero NO puede insertarlo', async () => {
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();

    const { data: sysVisible } = await sb
      .from('checklist_templates')
      .select('id')
      .eq('id', systemTemplateId)
      .maybeSingle();
    expect(sysVisible?.id).toBe(systemTemplateId);

    // INSERT de fila de sistema (consultora_id NULL) → RLS WITH CHECK lo rechaza.
    const { error } = await sb
      .from('checklist_templates')
      .insert({ consultora_id: null, nombre: nextName('Hack'), created_by: ownerAId });
    expect(error?.code).toBe('42501');
  });

  it('23. cross-tenant: ownerA NO ve el template de cB ni edita su versión', async () => {
    // Template+draft de cB.
    await signInAs(emailOwnerB);
    const { createChecklistTemplateAction } = await actions();
    const cb = await createChecklistTemplateAction({ nombre: nextName('TplB') });
    if (!cb.ok) throw new Error('setup cB');

    // ownerA no lo ve.
    await signInAs(emailOwnerA);
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const { data: hidden } = await sb
      .from('checklist_templates')
      .select('id')
      .eq('id', cb.templateId)
      .maybeSingle();
    expect(hidden).toBeNull();

    // ownerA no puede addSection a la versión de cB → NOT_FOUND (RLS oculta el guard).
    const { addSectionAction } = await actions();
    const r = await addSectionAction({ versionId: cb.versionId, titulo: 'X' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });
});
