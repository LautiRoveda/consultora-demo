/**
 * T-060a · Integration tests del lifecycle de ejecución de inspecciones.
 *
 * Cobertura:
 *  - createEjecucionAction: member happy (borrador) / NO_CLIENTE (cross-tenant) /
 *    VERSION_NOT_PUBLISHED (template sin versión publicada).
 *  - saveRespuestaAction: UPSERT happy / INVALID_INPUT (response_type mismatch).
 *  - cerrarEjecucionAction: EXEC_INCOMPLETE (es_requerido sin responder) /
 *    FORBIDDEN_NOT_OWNER (member) / happy (score + snapshot + firma + hash) /
 *    ALREADY_CLOSED / cross-tenant NOT_FOUND.
 *  - Freeze RLS: saveRespuesta sobre una ejecución cerrada → EXEC_NOT_DRAFT.
 *
 * Corre contra Supabase local (`pnpm test:integration`, T-111) — requiere Docker.
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
  throw new Error('Tests requieren NEXT_PUBLIC_SUPABASE_URL, ANON_KEY y SERVICE_ROLE_KEY.');
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// PNG transparente 1x1 — válido (magic bytes PNG reales).
const FIRMA_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';

const slugA = `t060a-${runId}`;
const slugB = `t060b-${runId}`;
const emailOwnerA = `t060a-own-${runId}@example.com`;
const emailMemberA = `t060a-mem-${runId}@example.com`;
const emailOwnerB = `t060b-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let clienteAId: string;
let clienteBId: string;

// Template publicado de A con 3 ítems cumple_no_aplica conocidos.
let templateId: string;
let versionId: string;
let item1Id: string; // req, no crítico
let item2Id: string; // req, crítico
let item3Id: string; // no req
let draftOnlyTemplateId: string; // sin versión publicada

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

type TplActions = typeof import('@/app/(app)/checklists/actions');
type ExecActions = typeof import('@/app/(app)/checklists/ejecuciones/actions');
const tplActions = (): Promise<TplActions> => import('@/app/(app)/checklists/actions');
const execActions = (): Promise<ExecActions> =>
  import('@/app/(app)/checklists/ejecuciones/actions');

/** Crea una ejecución borrador como member A y devuelve su id. */
async function freshExecution(): Promise<string> {
  await signInAs(emailMemberA);
  const { createEjecucionAction } = await execActions();
  const r = await createEjecucionAction({ templateId, clienteId: clienteAId });
  if (!r.ok) throw new Error(`freshExecution setup: ${JSON.stringify(r)}`);
  return r.executionId;
}

async function saveCumple(
  executionId: string,
  templateItemId: string,
  valor: 'si' | 'no' | 'na',
  fecha?: string,
) {
  const { saveRespuestaAction } = await execActions();
  return saveRespuestaAction({
    executionId,
    templateItemId,
    response_type: 'cumple_no_aplica',
    valor,
    ...(fecha ? { fecha_regularizacion: fecha } : {}),
  });
}

beforeAll(async () => {
  const cA = await createTestConsultora(admin, { name: 'T060A', slug: slugA });
  cAId = cA.id;
  const cB = await createTestConsultora(admin, { name: 'T060B', slug: slugB });
  cBId = cB.id;

  ownerAId = await mkUser(emailOwnerA);
  memberAId = await mkUser(emailMemberA);
  ownerBId = await mkUser(emailOwnerB);

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
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

  const cuitBase = Date.now().toString().slice(-8).padStart(8, '0');
  const { data: clA } = await admin
    .from('clientes')
    .insert({
      consultora_id: cAId,
      razon_social: `Cliente A ${runId}`,
      cuit: `30-${cuitBase}-1`,
      domicilio: 'Av Siempre Viva 742',
      localidad: 'CABA',
      provincia: 'Buenos Aires',
      created_by: ownerAId,
    })
    .select('id')
    .single();
  clienteAId = clA!.id;

  const { data: clB } = await admin
    .from('clientes')
    .insert({
      consultora_id: cBId,
      razon_social: `Cliente B ${runId}`,
      cuit: `27-${cuitBase}-2`,
      created_by: ownerBId,
    })
    .select('id')
    .single();
  clienteBId = clB!.id;

  // Template publicado de A: 3 ítems cumple_no_aplica (req / req+crítico / no-req).
  await signInAs(emailOwnerA);
  const { createChecklistTemplateAction, addSectionAction, addItemAction, publishVersionAction } =
    await tplActions();

  const tpl = await createChecklistTemplateAction({ nombre: nextName('TplExec') });
  if (!tpl.ok) throw new Error(`setup template: ${JSON.stringify(tpl)}`);
  templateId = tpl.templateId;
  versionId = tpl.versionId;

  const sec = await addSectionAction({ versionId, titulo: 'Sección' });
  if (!sec.ok) throw new Error('setup section');
  const i1 = await addItemAction({ sectionId: sec.sectionId, texto: 'Item req' });
  const i2 = await addItemAction({
    sectionId: sec.sectionId,
    texto: 'Item req crítico',
    es_critico: true,
  });
  const i3 = await addItemAction({
    sectionId: sec.sectionId,
    texto: 'Item opcional',
    es_requerido: false,
  });
  if (!i1.ok || !i2.ok || !i3.ok) throw new Error('setup items');
  item1Id = i1.itemId;
  item2Id = i2.itemId;
  item3Id = i3.itemId;

  const pub = await publishVersionAction({ versionId });
  if (!pub.ok) throw new Error(`setup publish: ${JSON.stringify(pub)}`);

  // Template draft-only (sin publicar) para VERSION_NOT_PUBLISHED.
  const draft = await createChecklistTemplateAction({ nombre: nextName('TplDraft') });
  if (!draft.ok) throw new Error('setup draft template');
  draftOnlyTemplateId = draft.templateId;
});

afterAll(async () => {
  // Orden: CAPAs (RESTRICT vs executions) + calendar (acciones→event SET NULL) →
  // executions (RESTRICT vs versions) → templates (cascade versions) → resto.
  await admin.from('calendar_event_reminders').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('calendar_events').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('acciones_correctivas').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('checklist_executions').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('checklist_templates').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('clientes').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('consultora_members').delete().in('consultora_id', [cAId, cBId]);
  await admin.from('consultoras').delete().in('id', [cAId, cBId]);
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(memberAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
  // Storage best-effort (no cascada desde DB).
  const { data: firmas } = await admin.storage.from('checklist-firmas').list(cAId);
  if (firmas?.length) {
    await admin.storage.from('checklist-firmas').remove(firmas.map((f) => `${cAId}/${f.name}`));
  }
});

beforeEach(() => {
  cookieStore.length = 0;
});

// ============================== createEjecucion ==============================

describe('createEjecucionAction', () => {
  it('1. member crea ejecución borrador (versión publicada + cliente del tenant)', async () => {
    await signInAs(emailMemberA);
    const { createEjecucionAction } = await execActions();
    const r = await createEjecucionAction({ templateId, clienteId: clienteAId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { data: exec } = await admin
      .from('checklist_executions')
      .select(
        'estado, consultora_id, template_version_id, cliente_id, created_by, inspector_user_id',
      )
      .eq('id', r.executionId)
      .single();
    expect(exec).toMatchObject({
      estado: 'borrador',
      consultora_id: cAId,
      template_version_id: versionId,
      cliente_id: clienteAId,
      created_by: memberAId,
      inspector_user_id: memberAId,
    });
  });

  it('2. cliente de otro tenant → NO_CLIENTE (RLS lo oculta)', async () => {
    await signInAs(emailMemberA);
    const { createEjecucionAction } = await execActions();
    const r = await createEjecucionAction({ templateId, clienteId: clienteBId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_CLIENTE');
  });

  it('3. template sin versión publicada → VERSION_NOT_PUBLISHED', async () => {
    await signInAs(emailMemberA);
    const { createEjecucionAction } = await execActions();
    const r = await createEjecucionAction({
      templateId: draftOnlyTemplateId,
      clienteId: clienteAId,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VERSION_NOT_PUBLISHED');
  });
});

// ============================== saveRespuesta ==============================

describe('saveRespuestaAction', () => {
  it('4. UPSERT happy (member) persiste valor', async () => {
    const executionId = await freshExecution();
    const r = await saveCumple(executionId, item1Id, 'si');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // T-061a: el action devuelve el respuestaId (la UI lo usa para atar la foto).
    expect(r.respuestaId).toMatch(/^[0-9a-f-]{36}$/);

    const { data: resp } = await admin
      .from('execution_respuestas')
      .select('id, valor, consultora_id')
      .eq('execution_id', executionId)
      .eq('template_item_id', item1Id)
      .single();
    expect(resp).toMatchObject({ id: r.respuestaId, valor: 'si', consultora_id: cAId });

    // Segundo save = UPDATE (mismo par execution+item, unique index) → mismo respuestaId.
    const r2 = await saveCumple(executionId, item1Id, 'no', '2026-07-01');
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.respuestaId).toBe(r.respuestaId);
    const { data: resp2 } = await admin
      .from('execution_respuestas')
      .select('valor, fecha_regularizacion')
      .eq('execution_id', executionId)
      .eq('template_item_id', item1Id)
      .single();
    expect(resp2).toMatchObject({ valor: 'no', fecha_regularizacion: '2026-07-01' });
  });

  it('5. response_type que no coincide con el ítem → INVALID_INPUT', async () => {
    const executionId = await freshExecution();
    const { saveRespuestaAction } = await execActions();
    const r = await saveRespuestaAction({
      executionId,
      templateItemId: item1Id, // es cumple_no_aplica
      response_type: 'si_no',
      valor: 'si',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT');
  });
});

// ============================== cerrar ==============================

describe('cerrarEjecucionAction', () => {
  it('6. ítems es_requerido sin responder → EXEC_INCOMPLETE con la lista', async () => {
    const executionId = await freshExecution();
    await saveCumple(executionId, item1Id, 'si'); // item2 (req) sin responder
    await signInAs(emailOwnerA);
    const { cerrarEjecucionAction } = await execActions();
    const r = await cerrarEjecucionAction({
      executionId,
      firma_base64: FIRMA_PNG,
      firmante_nombre: 'Ing. A',
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.code === 'EXEC_INCOMPLETE') {
      expect(r.faltantes.map((f) => f.id)).toContain(item2Id);
      expect(r.faltantes.map((f) => f.id)).not.toContain(item3Id); // opcional no bloquea
    } else {
      throw new Error(`esperaba EXEC_INCOMPLETE, got ${JSON.stringify(r)}`);
    }
  });

  it('7. member (no owner) NO puede cerrar → FORBIDDEN_NOT_OWNER', async () => {
    const executionId = await freshExecution();
    await saveCumple(executionId, item1Id, 'si');
    await saveCumple(executionId, item2Id, 'si');
    await signInAs(emailMemberA);
    const { cerrarEjecucionAction } = await execActions();
    const r = await cerrarEjecucionAction({
      executionId,
      firma_base64: FIRMA_PNG,
      firmante_nombre: 'X',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FORBIDDEN_NOT_OWNER');
  });

  it('8. owner cierra: score + snapshot + firma + hash; luego freeze + ALREADY_CLOSED', async () => {
    const executionId = await freshExecution();
    await saveCumple(executionId, item1Id, 'si'); // cumple
    await saveCumple(executionId, item2Id, 'no', '2026-08-15'); // no cumple (crítico)
    // item3 opcional sin responder → no bloquea.

    await signInAs(emailOwnerA);
    const { cerrarEjecucionAction } = await execActions();
    const r = await cerrarEjecucionAction({
      executionId,
      firma_base64: FIRMA_PNG,
      firmante_nombre: 'Ing. Pérez',
      firmante_matricula: 'MP-1234',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cumplimiento_pct).toBe(50);
    expect(r.tiene_criticos_incumplidos).toBe(true);

    const { data: exec } = await admin
      .from('checklist_executions')
      .select(
        'estado, cerrada_at, score_cumple, score_no_cumple, score_na, cumplimiento_pct, tiene_criticos_incumplidos, firma_pdf_hash, establecimiento_razon_social, establecimiento_cuit, establecimiento_domicilio',
      )
      .eq('id', executionId)
      .single();
    expect(exec?.estado).toBe('cerrada');
    expect(exec?.cerrada_at).not.toBeNull();
    expect(exec).toMatchObject({ score_cumple: 1, score_no_cumple: 1, score_na: 0 });
    expect(Number(exec?.cumplimiento_pct)).toBe(50);
    expect(exec?.tiene_criticos_incumplidos).toBe(true);
    expect(exec?.firma_pdf_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(exec?.establecimiento_razon_social).toBe(`Cliente A ${runId}`);
    expect(exec?.establecimiento_domicilio).toBe('Av Siempre Viva 742');

    // Firma persistida (tabla + storage).
    const { data: firma } = await admin
      .from('execution_firmas')
      .select('rol, firmante_nombre, firmante_matricula, firma_storage_path')
      .eq('execution_id', executionId)
      .single();
    expect(firma).toMatchObject({
      rol: 'matriculado',
      firmante_nombre: 'Ing. Pérez',
      firmante_matricula: 'MP-1234',
      firma_storage_path: `${cAId}/${executionId}.png`,
    });
    const { data: list } = await admin.storage.from('checklist-firmas').list(cAId);
    expect(list?.some((f) => f.name === `${executionId}.png`)).toBe(true);

    // Freeze: member ya NO puede guardar respuestas (parent cerrada).
    const save = await saveCumple(executionId, item3Id, 'si');
    expect(save.ok).toBe(false);
    if (!save.ok) expect(save.code).toBe('EXEC_NOT_DRAFT');

    // Re-cerrar → ALREADY_CLOSED.
    await signInAs(emailOwnerA);
    const again = await cerrarEjecucionAction({
      executionId,
      firma_base64: FIRMA_PNG,
      firmante_nombre: 'Ing. Pérez',
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('ALREADY_CLOSED');
  });

  it('9. cross-tenant: ownerB NO puede cerrar una ejecución de A → NOT_FOUND', async () => {
    const executionId = await freshExecution();
    await saveCumple(executionId, item1Id, 'si');
    await saveCumple(executionId, item2Id, 'si');
    await signInAs(emailOwnerB);
    const { cerrarEjecucionAction } = await execActions();
    const r = await cerrarEjecucionAction({
      executionId,
      firma_base64: FIRMA_PNG,
      firmante_nombre: 'B',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });
});

// fecha futura para que los reminders [30,7,0] no caigan en el pasado (gen los omite).
function futureDateISO(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

// ============================== CAPA + calendario (T-060b) ==============================

describe('cerrarEjecucionAction · CAPA + calendario', () => {
  it('10. cierre con un "no cumple" → 1 CAPA (alta) + calendar_event accion_correctiva + reminders [30,7,0]', async () => {
    const executionId = await freshExecution();
    const future = futureDateISO(90);
    await saveCumple(executionId, item1Id, 'si'); // cumple
    await saveCumple(executionId, item2Id, 'no', future); // no cumple (crítico → prioridad alta)

    await signInAs(emailOwnerA);
    const { cerrarEjecucionAction } = await execActions();
    const r = await cerrarEjecucionAction({
      executionId,
      firma_base64: FIRMA_PNG,
      firmante_nombre: 'Ing. Pérez',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.capaCount).toBe(1);

    const { data: capas } = await admin
      .from('acciones_correctivas')
      .select(
        'id, prioridad, fecha_compromiso, estado, calendar_event_id, cliente_id, respuesta_id',
      )
      .eq('execution_id', executionId);
    expect(capas?.length).toBe(1);
    const capa = capas![0]!;
    expect(capa.prioridad).toBe('alta');
    expect(capa.fecha_compromiso).toBe(future);
    expect(capa.estado).toBe('abierta');
    expect(capa.cliente_id).toBe(clienteAId);
    expect(capa.calendar_event_id).not.toBeNull();

    const { data: ev } = await admin
      .from('calendar_events')
      .select('tipo, status, fecha_vencimiento')
      .eq('id', capa.calendar_event_id!)
      .single();
    expect(ev).toMatchObject({
      tipo: 'accion_correctiva',
      status: 'pending',
      fecha_vencimiento: future,
    });

    const { data: reminders } = await admin
      .from('calendar_event_reminders')
      .select('offset_days, scheduled_at, status')
      .eq('event_id', capa.calendar_event_id!);
    expect((reminders ?? []).map((x) => x.offset_days).sort((a, b) => b - a)).toEqual([30, 7, 0]);
    for (const rem of reminders ?? []) {
      expect(rem.status).toBe('pending');
      expect(new Date(rem.scheduled_at).getTime()).toBeGreaterThan(Date.now());
    }

    // Idempotencia: re-invocar gen_acciones_calendar_for NO duplica el evento.
    await admin.rpc('gen_acciones_calendar_for', { p_execution_id: executionId });
    const { count } = await admin
      .from('calendar_events')
      .select('id', { count: 'exact', head: true })
      .contains('metadata', { execution_id: executionId });
    expect(count).toBe(1);
  });
});

// ============================== anularEjecucionAction (T-060b) ==============================

describe('anularEjecucionAction', () => {
  it('11. anular cerrada → CAPAs anuladas + eventos cancelled + reminders skipped + tombstone; retry → ALREADY_ANULLED', async () => {
    const executionId = await freshExecution();
    const future = futureDateISO(60);
    await saveCumple(executionId, item1Id, 'si');
    await saveCumple(executionId, item2Id, 'no', future);

    await signInAs(emailOwnerA);
    const { cerrarEjecucionAction, anularEjecucionAction } = await execActions();
    const closed = await cerrarEjecucionAction({
      executionId,
      firma_base64: FIRMA_PNG,
      firmante_nombre: 'Ing. Pérez',
    });
    expect(closed.ok).toBe(true);

    const { data: capaBefore } = await admin
      .from('acciones_correctivas')
      .select('id, calendar_event_id')
      .eq('execution_id', executionId)
      .single();
    const eventId = capaBefore!.calendar_event_id!;

    const an = await anularEjecucionAction({ executionId, motivo: 'Error de carga' });
    expect(an.ok).toBe(true);
    if (!an.ok) return;

    // Tombstone.
    const { data: tomb } = await admin
      .from('checklist_executions')
      .select('estado, anulacion, corrige_id')
      .eq('id', an.tombstoneId)
      .single();
    expect(tomb).toMatchObject({ estado: 'anulada', anulacion: true, corrige_id: executionId });

    // CAPA anulada.
    const { data: capaAfter } = await admin
      .from('acciones_correctivas')
      .select('estado')
      .eq('id', capaBefore!.id)
      .single();
    expect(capaAfter?.estado).toBe('anulada');

    // Evento cancelled + reminders skipped.
    const { data: ev } = await admin
      .from('calendar_events')
      .select('status')
      .eq('id', eventId)
      .single();
    expect(ev?.status).toBe('cancelled');
    const { data: rems } = await admin
      .from('calendar_event_reminders')
      .select('status')
      .eq('event_id', eventId);
    for (const rem of rems ?? []) expect(rem.status).toBe('skipped');

    // La ejecución original deja de ser vigente (el tombstone la supersede).
    const { data: vig } = await admin
      .from('checklist_executions_vigentes')
      .select('id')
      .eq('id', executionId)
      .maybeSingle();
    expect(vig).toBeNull();

    // Retry → ALREADY_ANULLED (uq_checklist_exec_corrige).
    const again = await anularEjecucionAction({ executionId, motivo: 'otra' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('ALREADY_ANULLED');
  });

  it('12. member (no owner) NO puede anular → FORBIDDEN_NOT_OWNER', async () => {
    const executionId = await freshExecution();
    await signInAs(emailMemberA);
    const { anularEjecucionAction } = await execActions();
    const r = await anularEjecucionAction({ executionId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FORBIDDEN_NOT_OWNER');
  });
});

// ============================== Vistas heads / vigentes (T-061-FU1) ==============================

describe('checklist_executions_heads (vista — T-061-FU1: anuladas incluidas)', () => {
  // Cliente member-scoped: lee las vistas con security_invoker → RLS de cA aplica.
  function memberAClient() {
    return createSbClient<Database>(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  it('13. anulada aparece en heads pero NO en vigentes; superseded en ninguna', async () => {
    // Cadena: borrador P ← tombstone Q (anula P). Insert directo via admin
    // (service-role bypassa la INSERT policy que fuerza estado=borrador/anulacion=false).
    const { data: p } = await admin
      .from('checklist_executions')
      .insert({
        consultora_id: cAId,
        created_by: ownerAId,
        template_version_id: versionId,
        cliente_id: clienteAId,
        estado: 'borrador',
      })
      .select('id')
      .single();
    const { data: q } = await admin
      .from('checklist_executions')
      .insert({
        consultora_id: cAId,
        created_by: ownerAId,
        template_version_id: versionId,
        cliente_id: clienteAId,
        estado: 'anulada',
        anulacion: true,
        corrige_id: p!.id,
      })
      .select('id')
      .single();

    const client = memberAClient();
    const { error: signInErr } = await client.auth.signInWithPassword({
      email: emailMemberA,
      password,
    });
    expect(signInErr).toBeNull();

    // heads: el head de la cadena es el tombstone Q (anulacion=true); P está superseded.
    const { data: heads, error: headsErr } = await client
      .from('checklist_executions_heads')
      .select('id, estado, anulacion')
      .in('id', [p!.id, q!.id]);
    expect(headsErr).toBeNull();
    expect((heads ?? []).map((r) => r.id)).toEqual([q!.id]);
    expect(heads?.[0]?.estado).toBe('anulada');
    expect(heads?.[0]?.anulacion).toBe(true);

    // vigentes: ninguno (la cadena está anulada).
    const { data: vig } = await client
      .from('checklist_executions_vigentes')
      .select('id')
      .in('id', [p!.id, q!.id]);
    expect(vig ?? []).toEqual([]);
  });

  it('14. heads respeta RLS: member de cA NO ve heads de cB (cross-tenant)', async () => {
    const { data: ins } = await admin
      .from('checklist_executions')
      .insert({
        consultora_id: cBId,
        created_by: ownerBId,
        template_version_id: versionId,
        cliente_id: clienteBId,
        estado: 'borrador',
      })
      .select('id')
      .single();

    const client = memberAClient();
    await client.auth.signInWithPassword({ email: emailMemberA, password });

    const { data, error } = await client
      .from('checklist_executions_heads')
      .select('id')
      .eq('id', ins!.id);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
