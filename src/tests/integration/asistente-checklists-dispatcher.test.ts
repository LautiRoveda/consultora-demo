/**
 * T-125 · Integration tests del DISPATCHER de Checklists/Inspecciones del asistente
 * IA + la tool transversal `buscar_cliente` + la query `getCapasForConsultora`.
 *
 * Mismo enfoque que `asistente-dispatcher.test.ts` (T-117): el dispatcher es
 * Anthropic-free → se testea determinísticamente contra una DB sembrada, sin
 * mockear el LLM. RLS se valida desde el server client autenticado. Cubre:
 *  1. cada tool devuelve los datos reales del tenant, con el shape recortado.
 *  2. filtros (cliente, estado, fecha, prioridad, ventana de días, vigencia).
 *  3. cross-tenant (cliente/inspección/CAPA de otra consultora) → vacío (RLS).
 *  4. input inválido → tool_result con isError, sin tirar.
 *
 * Siembra (patrón de `checklists-capa-resolve.test.ts`): template + versión
 * publicada + ejecuciones vía actions (por triggers/scoring); CAPAs manuales vía
 * admin.insert con fechas/estados/clientes controlados. Requiere Docker
 * (`pnpm test:integration`, T-111).
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
  throw new Error('Tests requieren env Supabase. Correr con .env.local cargado.');
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// PNG transparente 1x1 — válido (magic bytes PNG reales) para firmar el cierre.
const FIRMA_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';
const slugA = `t125a-${runId}`;
const slugB = `t125b-${runId}`;
const emailOwnerA = `t125a-own-${runId}@example.com`;
const emailOwnerB = `t125b-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;
let clienteA1Id: string;
let clienteA2Id: string;
let clienteBId: string;

let templateAId: string;
let execCerradaId: string;
let execBorradorId: string;
let execAnuladaId: string;
// La anulación crea un TOMBSTONE (fila nueva, corrige_id→original, estado='anulada')
// que pasa a ser la cabeza de la cadena. Es ese id —no el original— el que aparece
// al filtrar inspecciones anuladas (heads).
let execAnuladaTombstoneId: string;
let execBId: string;

// Descripciones únicas (con runId) para localizar CAPAs por contenido en los asserts.
const DESC_VENCIDA = `Reponer matafuegos vencidos ${runId}`;
const DESC_PROXIMA = `Senalizar salida de emergencia ${runId}`;
const DESC_LEJANA = `Actualizar plano de evacuacion ${runId}`;
const DESC_CERRADA = `Capacitar en uso de EPP ${runId}`;
const DESC_B = `CAPA cross-tenant B ${runId}`;

function dateISO(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
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

async function rlsClient() {
  const { createClient } = await import('@/shared/supabase/server');
  return createClient();
}

// Las tools del chat se ejecutan SIEMPRE como owner de A (el caso cross-tenant
// verifica que A no ve datos de B). `beforeEach` limpia las cookies, así que hay
// que firmar la sesión acá dentro o el cliente RLS corre anónimo (→ todo []).
async function dispatch(name: string, input: unknown, consultoraId: string) {
  await signInAs(emailOwnerA);
  const { dispatchTool } = await import('@/shared/ai/tools/registry');
  const supabase = await rlsClient();
  return dispatchTool({ name, input, supabase, consultoraId });
}

type ChecklistActions = typeof import('@/app/(app)/checklists/actions');
type ExecActions = typeof import('@/app/(app)/checklists/ejecuciones/actions');
const checklistActions = (): Promise<ChecklistActions> => import('@/app/(app)/checklists/actions');
const execActions = (): Promise<ExecActions> =>
  import('@/app/(app)/checklists/ejecuciones/actions');

/** Template publicado con 2 ítems cumple_no_aplica (uno crítico). Devuelve templateId. */
async function seedTemplatePublicado(ownerEmail: string, nombre: string): Promise<string> {
  await signInAs(ownerEmail);
  const { createChecklistTemplateAction, addSectionAction, addItemAction, publishVersionAction } =
    await checklistActions();
  const tpl = await createChecklistTemplateAction({ nombre });
  if (!tpl.ok) throw new Error(`setup template: ${JSON.stringify(tpl)}`);
  const sec = await addSectionAction({ versionId: tpl.versionId, titulo: 'Sección' });
  if (!sec.ok) throw new Error('setup section');
  const i1 = await addItemAction({ sectionId: sec.sectionId, texto: 'Item req' });
  const i2 = await addItemAction({
    sectionId: sec.sectionId,
    texto: 'Item req crítico',
    es_critico: true,
  });
  if (!i1.ok || !i2.ok) throw new Error('setup items');
  const pub = await publishVersionAction({ versionId: tpl.versionId });
  if (!pub.ok) throw new Error(`setup publish: ${JSON.stringify(pub)}`);
  return tpl.templateId;
}

/** Crea una ejecución borrador (como ownerEmail) para `clienteId`. Devuelve executionId. */
async function seedBorrador(
  ownerEmail: string,
  templateId: string,
  clienteId: string,
): Promise<string> {
  await signInAs(ownerEmail);
  const { createEjecucionAction } = await execActions();
  const created = await createEjecucionAction({ templateId, clienteId });
  if (!created.ok) throw new Error(`setup borrador: ${JSON.stringify(created)}`);
  return created.executionId;
}

/** Crea + cierra una ejecución (genera una CAPA abierta del ítem crítico no cumplido). */
async function seedCerrada(
  ownerEmail: string,
  templateId: string,
  clienteId: string,
): Promise<string> {
  const executionId = await seedBorrador(ownerEmail, templateId, clienteId);
  const { saveRespuestaAction, cerrarEjecucionAction } = await execActions();
  // Respondemos ambos ítems del template de ESTA ejecución; el crítico "no cumple"
  // con fecha futura → CAPA abierta al cerrar. Resolvemos los ítems desde la versión.
  const { data: exec } = await admin
    .from('checklist_executions')
    .select('template_version_id')
    .eq('id', executionId)
    .single();
  const { data: items } = await admin
    .from('template_items')
    .select('id, es_critico, orden')
    .eq('version_id', exec!.template_version_id)
    .order('orden', { ascending: true });
  const itemReq = items!.find((i) => !i.es_critico)!;
  const itemCrit = items!.find((i) => i.es_critico)!;

  const s1 = await saveRespuestaAction({
    executionId,
    templateItemId: itemReq.id,
    response_type: 'cumple_no_aplica',
    valor: 'si',
  });
  const s2 = await saveRespuestaAction({
    executionId,
    templateItemId: itemCrit.id,
    response_type: 'cumple_no_aplica',
    valor: 'no',
    fecha_regularizacion: dateISO(90),
  });
  if (!s1.ok || !s2.ok) throw new Error('setup respuestas cerrada');

  await signInAs(ownerEmail);
  const closed = await cerrarEjecucionAction({
    executionId,
    firma_base64: FIRMA_PNG,
    firmante_nombre: 'Ing. Pérez',
  });
  if (!closed.ok) throw new Error(`setup cerrar: ${JSON.stringify(closed)}`);
  return executionId;
}

/** Inserta una CAPA manual (respuesta_id NULL) con admin → control total de fecha/estado. */
async function insertCapa(args: {
  consultoraId: string;
  executionId: string;
  clienteId: string;
  ownerId: string;
  descripcion: string;
  prioridad: 'baja' | 'media' | 'alta';
  estado: 'abierta' | 'en_progreso' | 'cerrada' | 'anulada';
  fechaCompromiso: string;
}): Promise<void> {
  const { error } = await admin.from('acciones_correctivas').insert({
    consultora_id: args.consultoraId,
    execution_id: args.executionId,
    cliente_id: args.clienteId,
    descripcion: args.descripcion,
    prioridad: args.prioridad,
    estado: args.estado,
    fecha_compromiso: args.fechaCompromiso,
    created_by: args.ownerId,
  });
  if (error) throw new Error(`insertCapa ${args.descripcion}: ${error.message}`);
}

beforeAll(async () => {
  cAId = (await createTestConsultora(admin, { name: 'T125A', slug: slugA })).id;
  cBId = (await createTestConsultora(admin, { name: 'T125B', slug: slugB })).id;

  ownerAId = await mkUser(emailOwnerA);
  ownerBId = await mkUser(emailOwnerB);
  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, {
      app_metadata: { consultora_id: cAId, consultora_role: 'owner' },
    }),
    admin.auth.admin.updateUserById(ownerBId, {
      app_metadata: { consultora_id: cBId, consultora_role: 'owner' },
    }),
  ]);

  const cuitBase = Date.now().toString().slice(-8).padStart(8, '0');
  clienteA1Id = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Acme Industrial ${runId}`,
        cuit: `30-${cuitBase}-1`,
        domicilio: 'Av Siempre Viva 742',
        localidad: 'CABA',
        provincia: 'Buenos Aires',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  clienteA2Id = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cAId,
        razon_social: `Beta Servicios ${runId}`,
        cuit: `30-${cuitBase}-2`,
        localidad: 'Córdoba',
        provincia: 'Córdoba',
        created_by: ownerAId,
      })
      .select('id')
      .single()
  ).data!.id;
  clienteBId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cBId,
        razon_social: `Empresa B ${runId}`,
        cuit: `33-${cuitBase}-3`,
        created_by: ownerBId,
      })
      .select('id')
      .single()
  ).data!.id;

  // Consultora A: template + ejecuciones en varios estados.
  templateAId = await seedTemplatePublicado(emailOwnerA, `TplT125A-${runId}`);
  execCerradaId = await seedCerrada(emailOwnerA, templateAId, clienteA1Id);
  execBorradorId = await seedBorrador(emailOwnerA, templateAId, clienteA1Id);
  execAnuladaId = await seedCerrada(emailOwnerA, templateAId, clienteA1Id);
  await signInAs(emailOwnerA);
  const { anularEjecucionAction } = await execActions();
  const an = await anularEjecucionAction({ executionId: execAnuladaId, motivo: 'Duplicada' });
  if (!an.ok) throw new Error(`setup anular: ${JSON.stringify(an)}`);
  execAnuladaTombstoneId = an.tombstoneId;

  // CAPAs manuales con fechas/estados/clientes controlados (sobre la ejecución cerrada).
  await insertCapa({
    consultoraId: cAId,
    executionId: execCerradaId,
    clienteId: clienteA1Id,
    ownerId: ownerAId,
    descripcion: DESC_VENCIDA,
    prioridad: 'alta',
    estado: 'abierta',
    fechaCompromiso: dateISO(-10),
  });
  await insertCapa({
    consultoraId: cAId,
    executionId: execCerradaId,
    clienteId: clienteA1Id,
    ownerId: ownerAId,
    descripcion: DESC_PROXIMA,
    prioridad: 'media',
    estado: 'en_progreso',
    fechaCompromiso: dateISO(5),
  });
  await insertCapa({
    consultoraId: cAId,
    executionId: execCerradaId,
    clienteId: clienteA2Id,
    ownerId: ownerAId,
    descripcion: DESC_LEJANA,
    prioridad: 'baja',
    estado: 'abierta',
    fechaCompromiso: dateISO(25),
  });
  await insertCapa({
    consultoraId: cAId,
    executionId: execCerradaId,
    clienteId: clienteA1Id,
    ownerId: ownerAId,
    descripcion: DESC_CERRADA,
    prioridad: 'media',
    estado: 'cerrada',
    fechaCompromiso: dateISO(8),
  });

  // Consultora B: template + ejecución borrador + CAPA (para cross-tenant).
  const templateBId = await seedTemplatePublicado(emailOwnerB, `TplT125B-${runId}`);
  execBId = await seedBorrador(emailOwnerB, templateBId, clienteBId);
  await insertCapa({
    consultoraId: cBId,
    executionId: execBId,
    clienteId: clienteBId,
    ownerId: ownerBId,
    descripcion: DESC_B,
    prioridad: 'alta',
    estado: 'abierta',
    fechaCompromiso: dateISO(3),
  });
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
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
  for (const c of [cAId, cBId]) {
    const { data: firmas } = await admin.storage.from('checklist-firmas').list(c);
    if (firmas?.length) {
      await admin.storage.from('checklist-firmas').remove(firmas.map((f) => `${c}/${f.name}`));
    }
  }
});

beforeEach(() => {
  cookieStore.length = 0;
});

describe('buscar_cliente', () => {
  it('encuentra un cliente por razón social, con shape recortado', async () => {
    const res = await dispatch('buscar_cliente', { query: 'Acme Industrial' }, cAId);
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.content) as Array<Record<string, unknown>>;
    const found = rows.find((r) => r.id === clienteA1Id);
    expect(found).toBeDefined();
    expect(found).toMatchObject({ razon_social: `Acme Industrial ${runId}`, localidad: 'CABA' });
  });

  it('cross-tenant: el cliente de B no aparece logueado como A', async () => {
    const res = await dispatch('buscar_cliente', { query: 'Empresa B' }, cAId);
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content)).toEqual([]);
  });
});

describe('listar_inspecciones', () => {
  it('default: trae vigentes (cerrada + borrador), NO la anulada', async () => {
    const res = await dispatch('listar_inspecciones', {}, cAId);
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.content) as Array<{ id: string; estado: string; cliente: unknown }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(execCerradaId);
    expect(ids).toContain(execBorradorId);
    expect(ids).not.toContain(execAnuladaId);
    // La cerrada snapshotea el nombre del establecimiento; la borrador aún no.
    const cerrada = rows.find((r) => r.id === execCerradaId);
    expect(cerrada?.cliente).toBe(`Acme Industrial ${runId}`);
  });

  it('filtra por estado=cerrada', async () => {
    const res = await dispatch('listar_inspecciones', { estado: 'cerrada' }, cAId);
    const rows = JSON.parse(res.content) as Array<{ id: string }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(execCerradaId);
    expect(ids).not.toContain(execBorradorId);
  });

  it('estado=anulada implica leer heads → trae el tombstone de la anulada', async () => {
    const res = await dispatch('listar_inspecciones', { estado: 'anulada' }, cAId);
    const rows = JSON.parse(res.content) as Array<{ id: string; estado: string }>;
    // La cabeza de la cadena anulada es el tombstone (id propio), no la original.
    expect(rows.map((r) => r.id)).toContain(execAnuladaTombstoneId);
    expect(rows.map((r) => r.id)).not.toContain(execAnuladaId);
    expect(rows.every((r) => r.estado === 'anulada')).toBe(true);
  });

  it('filtra por cliente_id', async () => {
    const res = await dispatch('listar_inspecciones', { cliente_id: clienteA1Id }, cAId);
    const rows = JSON.parse(res.content) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toContain(execCerradaId);
  });

  it('cross-tenant: la inspección de B no aparece logueado como A', async () => {
    const res = await dispatch('listar_inspecciones', { incluir_anuladas: true }, cAId);
    const rows = JSON.parse(res.content) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).not.toContain(execBId);
  });
});

describe('inspeccion_detalle', () => {
  it('trae header + CAPAs, sin adjuntos/firma/sections', async () => {
    const res = await dispatch('inspeccion_detalle', { execution_id: execCerradaId }, cAId);
    expect(res.isError).toBe(false);
    const detalle = JSON.parse(res.content) as Record<string, unknown>;
    expect(detalle.encontrada).toBe(true);
    expect(detalle.estado).toBe('cerrada');
    expect(detalle.cliente).toBe(`Acme Industrial ${runId}`);
    expect(Array.isArray(detalle.capas)).toBe(true);
    expect((detalle.capas as unknown[]).length).toBeGreaterThanOrEqual(1);
    // Token blowup guard: NO mandamos estructura completa ni evidencia pesada.
    expect(detalle).not.toHaveProperty('adjuntos');
    expect(detalle).not.toHaveProperty('firmaMatriculado');
    expect(detalle).not.toHaveProperty('sections');
    expect(detalle).not.toHaveProperty('respuestasByItemId');
    expect(res.content).not.toContain('calendar_event_id');
  });

  it('id inexistente → encontrada:false (no error)', async () => {
    const res = await dispatch(
      'inspeccion_detalle',
      { execution_id: '00000000-0000-0000-0000-000000000000' },
      cAId,
    );
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content)).toMatchObject({ encontrada: false });
  });

  it('cross-tenant: la inspección de B → encontrada:false', async () => {
    const res = await dispatch('inspeccion_detalle', { execution_id: execBId }, cAId);
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content)).toMatchObject({ encontrada: false });
  });
});

describe('capas_pendientes', () => {
  it('default: pendientes (abierta + en_progreso), ordenadas por fecha ASC, sin cerradas', async () => {
    const res = await dispatch('capas_pendientes', {}, cAId);
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.content) as Array<{
      descripcion: string;
      fecha_compromiso: string;
    }>;
    const descs = rows.map((r) => r.descripcion);
    expect(descs).toContain(DESC_VENCIDA);
    expect(descs).toContain(DESC_PROXIMA);
    expect(descs).not.toContain(DESC_CERRADA); // estado cerrada → excluida
    expect(descs).not.toContain(DESC_B); // cross-tenant
    // Orden ASC por fecha_compromiso.
    const fechas = rows.map((r) => r.fecha_compromiso);
    const sorted = [...fechas].sort();
    expect(fechas).toEqual(sorted);
  });

  it('dentro_de_dias=15 → incluye vencida + próxima, excluye la lejana (+25)', async () => {
    const res = await dispatch('capas_pendientes', { dentro_de_dias: 15 }, cAId);
    const descs = (JSON.parse(res.content) as Array<{ descripcion: string }>).map(
      (r) => r.descripcion,
    );
    expect(descs).toContain(DESC_VENCIDA);
    expect(descs).toContain(DESC_PROXIMA);
    expect(descs).not.toContain(DESC_LEJANA);
  });

  it('filtra por cliente_id (A2) → sólo la CAPA de ese cliente', async () => {
    const res = await dispatch('capas_pendientes', { cliente_id: clienteA2Id }, cAId);
    const rows = JSON.parse(res.content) as Array<{ descripcion: string; cliente: string }>;
    const descs = rows.map((r) => r.descripcion);
    expect(descs).toContain(DESC_LEJANA);
    expect(descs).not.toContain(DESC_VENCIDA);
    expect(rows.find((r) => r.descripcion === DESC_LEJANA)?.cliente).toBe(
      `Beta Servicios ${runId}`,
    );
  });

  it('filtra por prioridad=alta', async () => {
    const res = await dispatch('capas_pendientes', { prioridad: 'alta' }, cAId);
    const descs = (JSON.parse(res.content) as Array<{ descripcion: string }>).map(
      (r) => r.descripcion,
    );
    expect(descs).toContain(DESC_VENCIDA);
    expect(descs).not.toContain(DESC_PROXIMA);
  });

  it('estados=[cerrada] → trae la cerrada, ninguna pendiente', async () => {
    const res = await dispatch('capas_pendientes', { estados: ['cerrada'] }, cAId);
    const descs = (JSON.parse(res.content) as Array<{ descripcion: string }>).map(
      (r) => r.descripcion,
    );
    expect(descs).toContain(DESC_CERRADA);
    expect(descs).not.toContain(DESC_VENCIDA);
  });

  it('cross-tenant: la CAPA de B no aparece logueado como A', async () => {
    const res = await dispatch('capas_pendientes', {}, cAId);
    const descs = (JSON.parse(res.content) as Array<{ descripcion: string }>).map(
      (r) => r.descripcion,
    );
    expect(descs).not.toContain(DESC_B);
  });
});

describe('input inválido / tool desconocida', () => {
  it('listar_inspecciones con cliente_id no-UUID → isError', async () => {
    const res = await dispatch('listar_inspecciones', { cliente_id: 'no-es-uuid' }, cAId);
    expect(res.isError).toBe(true);
  });

  it('inspeccion_detalle sin execution_id → isError', async () => {
    const res = await dispatch('inspeccion_detalle', {}, cAId);
    expect(res.isError).toBe(true);
  });
});

describe('getCapasForConsultora (query)', () => {
  it('default: pendientes, orden ASC, cliente_razon_social resuelto', async () => {
    await signInAs(emailOwnerA);
    const supabase = await rlsClient();
    const { getCapasForConsultora } = await import('@/app/(app)/checklists/ejecuciones/queries');
    const capas = await getCapasForConsultora(supabase);
    const mine = capas.filter((c) => c.descripcion.endsWith(runId));
    const descs = mine.map((c) => c.descripcion);
    expect(descs).toContain(DESC_VENCIDA);
    expect(descs).not.toContain(DESC_CERRADA);
    const fechas = capas.map((c) => c.fecha_compromiso);
    expect(fechas).toEqual([...fechas].sort());
    expect(mine.find((c) => c.descripcion === DESC_VENCIDA)?.cliente_razon_social).toBe(
      `Acme Industrial ${runId}`,
    );
  });

  it('filtros estado + prioridad + fecha + cliente', async () => {
    await signInAs(emailOwnerA);
    const supabase = await rlsClient();
    const { getCapasForConsultora } = await import('@/app/(app)/checklists/ejecuciones/queries');

    const alta = await getCapasForConsultora(supabase, { prioridad: 'alta' });
    expect(alta.map((c) => c.descripcion)).toContain(DESC_VENCIDA);

    const cerradas = await getCapasForConsultora(supabase, { estados: ['cerrada'] });
    expect(cerradas.map((c) => c.descripcion)).toContain(DESC_CERRADA);

    const delA2 = await getCapasForConsultora(supabase, { clienteId: clienteA2Id });
    expect(delA2.map((c) => c.descripcion)).toContain(DESC_LEJANA);
    expect(delA2.map((c) => c.descripcion)).not.toContain(DESC_VENCIDA);

    const hastaHoy = await getCapasForConsultora(supabase, { fechaHasta: dateISO(0) });
    const hastaHoyDescs = hastaHoy.map((c) => c.descripcion);
    expect(hastaHoyDescs).toContain(DESC_VENCIDA); // -10 días
    expect(hastaHoyDescs).not.toContain(DESC_LEJANA); // +25 días
  });

  it('cross-tenant: logueado como B no ve las CAPAs de A', async () => {
    await signInAs(emailOwnerB);
    const supabase = await rlsClient();
    const { getCapasForConsultora } = await import('@/app/(app)/checklists/ejecuciones/queries');
    const capas = await getCapasForConsultora(supabase, { estados: ['abierta', 'en_progreso'] });
    const descs = capas.map((c) => c.descripcion);
    expect(descs).not.toContain(DESC_VENCIDA);
    expect(descs).toContain(DESC_B);
  });
});
