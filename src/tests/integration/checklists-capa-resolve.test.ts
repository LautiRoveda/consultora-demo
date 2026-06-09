/**
 * T-120 · Integration tests de resolverCapaAction (cierre de CAPA con evidencia
 * desde la ficha de inspección).
 *
 * Cobertura:
 *  1. Happy (owner): CAPA abierta → cerrada + cerrada_at/cerrada_por/evidencia_cierre
 *     + su calendar_event completed + reminders skipped.
 *  2. Member ≠ creador del evento: el evento igual llega a completed (regresión del
 *     fix service-role; con cliente RLS serían 0 filas silenciosas).
 *  3. Ya cerrada / anulada → ALREADY_CLOSED (con el mensaje específico de anulada).
 *  4. Cross-tenant → NOT_FOUND.
 *  5. No-conflicto vs T-118: evidencia_cierre/cerrada_por se preservan tras el trigger
 *     (que dispara al completar el evento) = no pisa ni revierte.
 *  6. Evidencia < 5 chars → INVALID_INPUT, sin mutación.
 *  7. CAPA en_progreso → cerrada (el guard acepta el estado intermedio).
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

const slugA = `t120a-${runId}`;
const slugB = `t120b-${runId}`;
const emailOwnerA = `t120a-own-${runId}@example.com`;
const emailMemberA = `t120a-mem-${runId}@example.com`;
const emailOwnerB = `t120b-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let clienteAId: string;

let templateId: string;
let item1Id: string; // req, cumple
let item2Id: string; // req crítico, no cumple → CAPA alta

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

type ExecActions = typeof import('@/app/(app)/checklists/ejecuciones/actions');
const execActions = (): Promise<ExecActions> =>
  import('@/app/(app)/checklists/ejecuciones/actions');

// fecha futura para que los reminders [30,7,0] no caigan en el pasado (gen los omite).
function futureDateISO(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

async function saveCumple(
  executionId: string,
  templateItemId: string,
  valor: 'si' | 'no',
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

/**
 * Crea una ejecución (como `creatorEmail`), responde un "no cumple" con fecha futura
 * y la cierra como owner → devuelve la CAPA generada + su evento de calendario.
 * El evento queda con created_by = creador de la ejecución (espeja gen_acciones_calendar_for).
 */
async function closedExecutionWithCapa(creatorEmail: string): Promise<{
  executionId: string;
  capaId: string;
  eventId: string;
  future: string;
}> {
  await signInAs(creatorEmail);
  const { createEjecucionAction } = await execActions();
  const created = await createEjecucionAction({ templateId, clienteId: clienteAId });
  if (!created.ok) throw new Error(`setup create: ${JSON.stringify(created)}`);
  const executionId = created.executionId;

  const future = futureDateISO(90);
  const s1 = await saveCumple(executionId, item1Id, 'si');
  const s2 = await saveCumple(executionId, item2Id, 'no', future);
  if (!s1.ok || !s2.ok) throw new Error('setup respuestas');

  await signInAs(emailOwnerA);
  const { cerrarEjecucionAction } = await execActions();
  const closed = await cerrarEjecucionAction({
    executionId,
    firma_base64: FIRMA_PNG,
    firmante_nombre: 'Ing. Pérez',
  });
  if (!closed.ok) throw new Error(`setup cerrar: ${JSON.stringify(closed)}`);

  const { data: capa } = await admin
    .from('acciones_correctivas')
    .select('id, calendar_event_id, estado')
    .eq('execution_id', executionId)
    .single();
  if (!capa || capa.estado !== 'abierta' || !capa.calendar_event_id) {
    throw new Error(`setup CAPA inesperada: ${JSON.stringify(capa)}`);
  }
  return { executionId, capaId: capa.id, eventId: capa.calendar_event_id, future };
}

beforeAll(async () => {
  const cA = await createTestConsultora(admin, { name: 'T120A', slug: slugA });
  cAId = cA.id;
  const cB = await createTestConsultora(admin, { name: 'T120B', slug: slugB });
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

  // Template publicado de A: 2 ítems cumple_no_aplica (req / req+crítico).
  await signInAs(emailOwnerA);
  const { createChecklistTemplateAction, addSectionAction, addItemAction, publishVersionAction } =
    await import('@/app/(app)/checklists/actions');

  const tpl = await createChecklistTemplateAction({ nombre: `TplT120-${runId}` });
  if (!tpl.ok) throw new Error(`setup template: ${JSON.stringify(tpl)}`);
  templateId = tpl.templateId;

  const sec = await addSectionAction({ versionId: tpl.versionId, titulo: 'Sección' });
  if (!sec.ok) throw new Error('setup section');
  const i1 = await addItemAction({ sectionId: sec.sectionId, texto: 'Item req' });
  const i2 = await addItemAction({
    sectionId: sec.sectionId,
    texto: 'Item req crítico',
    es_critico: true,
  });
  if (!i1.ok || !i2.ok) throw new Error('setup items');
  item1Id = i1.itemId;
  item2Id = i2.itemId;

  const pub = await publishVersionAction({ versionId: tpl.versionId });
  if (!pub.ok) throw new Error(`setup publish: ${JSON.stringify(pub)}`);
});

afterAll(async () => {
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
  const { data: firmas } = await admin.storage.from('checklist-firmas').list(cAId);
  if (firmas?.length) {
    await admin.storage.from('checklist-firmas').remove(firmas.map((f) => `${cAId}/${f.name}`));
  }
});

beforeEach(() => {
  cookieStore.length = 0;
});

describe('resolverCapaAction', () => {
  it('1. owner resuelve: CAPA cerrada + cerrada_at/por/evidencia + evento completed + reminders skipped', async () => {
    const { capaId, eventId } = await closedExecutionWithCapa(emailMemberA);

    await signInAs(emailOwnerA);
    const { resolverCapaAction } = await execActions();
    const r = await resolverCapaAction({
      capaId,
      evidencia_cierre: 'Se reemplazaron los matafuegos vencidos; foto en el legajo.',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.calendarWarning).toBeUndefined();

    const { data: capa } = await admin
      .from('acciones_correctivas')
      .select('estado, cerrada_at, cerrada_por, evidencia_cierre')
      .eq('id', capaId)
      .single();
    expect(capa?.estado).toBe('cerrada');
    expect(capa?.cerrada_at).not.toBeNull();
    expect(capa?.cerrada_por).toBe(ownerAId);
    expect(capa?.evidencia_cierre).toBe(
      'Se reemplazaron los matafuegos vencidos; foto en el legajo.',
    );

    const { data: ev } = await admin
      .from('calendar_events')
      .select('status, completed_at, completed_by')
      .eq('id', eventId)
      .single();
    expect(ev?.status).toBe('completed');
    expect(ev?.completed_at).not.toBeNull();
    expect(ev?.completed_by).toBe(ownerAId);

    const { data: rems } = await admin
      .from('calendar_event_reminders')
      .select('status')
      .eq('event_id', eventId);
    expect((rems ?? []).length).toBeGreaterThan(0);
    for (const rem of rems ?? []) expect(rem.status).toBe('skipped');
  });

  it('2. member ≠ creador resuelve: el evento igual llega a completed (fix service-role)', async () => {
    // Ejecución creada por OWNER → evento.created_by = ownerA. Resuelve un MEMBER
    // (≠ creador, no-owner): vía cliente RLS sería 0 filas; service-role lo completa.
    const { capaId, eventId } = await closedExecutionWithCapa(emailOwnerA);

    await signInAs(emailMemberA);
    const { resolverCapaAction } = await execActions();
    const r = await resolverCapaAction({
      capaId,
      evidencia_cierre: 'Regularizado por el técnico.',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.calendarWarning).toBeUndefined();

    const { data: ev } = await admin
      .from('calendar_events')
      .select('status, completed_by')
      .eq('id', eventId)
      .single();
    expect(ev?.status).toBe('completed');
    expect(ev?.completed_by).toBe(memberAId);

    const { data: capa } = await admin
      .from('acciones_correctivas')
      .select('estado, cerrada_por')
      .eq('id', capaId)
      .single();
    expect(capa?.estado).toBe('cerrada');
    expect(capa?.cerrada_por).toBe(memberAId);
  });

  it('3a. resolver una CAPA ya cerrada → ALREADY_CLOSED', async () => {
    const { capaId } = await closedExecutionWithCapa(emailMemberA);
    await signInAs(emailOwnerA);
    const { resolverCapaAction } = await execActions();

    const first = await resolverCapaAction({ capaId, evidencia_cierre: 'Cierre inicial.' });
    expect(first.ok).toBe(true);

    const again = await resolverCapaAction({ capaId, evidencia_cierre: 'Otro intento.' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('ALREADY_CLOSED');
  });

  it('3b. resolver una CAPA anulada → ALREADY_CLOSED con mensaje de anulada', async () => {
    const { executionId, capaId } = await closedExecutionWithCapa(emailMemberA);
    await signInAs(emailOwnerA);
    const { anularEjecucionAction, resolverCapaAction } = await execActions();

    const an = await anularEjecucionAction({ executionId, motivo: 'Duplicada' });
    expect(an.ok).toBe(true);

    const r = await resolverCapaAction({ capaId, evidencia_cierre: 'No debería poder.' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('ALREADY_CLOSED');
      expect(r.message).toMatch(/anulada/i);
    }
  });

  it('4. cross-tenant: ownerB NO ve la CAPA de A → NOT_FOUND', async () => {
    const { capaId } = await closedExecutionWithCapa(emailMemberA);
    await signInAs(emailOwnerB);
    const { resolverCapaAction } = await execActions();
    const r = await resolverCapaAction({ capaId, evidencia_cierre: 'Intento cross-tenant.' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });

  it('5. no-conflicto vs T-118: el trigger no pisa evidencia_cierre/cerrada_por', async () => {
    // Al completar el evento, el trigger sync_calendar_event_to_origin dispara e intenta
    // cerrar la CAPA → guard `estado not in (finales)` = no-op (ya está cerrada). Los
    // campos de evidencia/actor que escribimos antes se preservan.
    const { capaId, eventId } = await closedExecutionWithCapa(emailMemberA);
    await signInAs(emailOwnerA);
    const { resolverCapaAction } = await execActions();
    const r = await resolverCapaAction({
      capaId,
      evidencia_cierre: 'Evidencia que el trigger NO debe pisar.',
    });
    expect(r.ok).toBe(true);

    // El evento quedó completed (condición que dispara el trigger).
    const { data: ev } = await admin
      .from('calendar_events')
      .select('status')
      .eq('id', eventId)
      .single();
    expect(ev?.status).toBe('completed');

    // ...y la CAPA conserva evidencia + actor (no fueron sobreescritos a NULL).
    const { data: capa } = await admin
      .from('acciones_correctivas')
      .select('estado, evidencia_cierre, cerrada_por')
      .eq('id', capaId)
      .single();
    expect(capa?.estado).toBe('cerrada');
    expect(capa?.evidencia_cierre).toBe('Evidencia que el trigger NO debe pisar.');
    expect(capa?.cerrada_por).toBe(ownerAId);
  });

  it('6. evidencia < 5 chars → INVALID_INPUT, la CAPA sigue abierta', async () => {
    const { capaId } = await closedExecutionWithCapa(emailMemberA);
    await signInAs(emailOwnerA);
    const { resolverCapaAction } = await execActions();
    const r = await resolverCapaAction({ capaId, evidencia_cierre: 'ab' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT');

    const { data: capa } = await admin
      .from('acciones_correctivas')
      .select('estado, evidencia_cierre')
      .eq('id', capaId)
      .single();
    expect(capa?.estado).toBe('abierta');
    expect(capa?.evidencia_cierre).toBeNull();
  });

  it('7. CAPA en_progreso → cerrada (el guard acepta el estado intermedio)', async () => {
    const { capaId } = await closedExecutionWithCapa(emailMemberA);
    // Nada en la app setea en_progreso hoy; lo forzamos vía service-role para cubrir el guard.
    await admin.from('acciones_correctivas').update({ estado: 'en_progreso' }).eq('id', capaId);

    await signInAs(emailOwnerA);
    const { resolverCapaAction } = await execActions();
    const r = await resolverCapaAction({ capaId, evidencia_cierre: 'Cerrada desde en_progreso.' });
    expect(r.ok).toBe(true);

    const { data: capa } = await admin
      .from('acciones_correctivas')
      .select('estado, evidencia_cierre, cerrada_por')
      .eq('id', capaId)
      .single();
    expect(capa?.estado).toBe('cerrada');
    expect(capa?.evidencia_cierre).toBe('Cerrada desde en_progreso.');
    expect(capa?.cerrada_por).toBe(ownerAId);
  });
});
