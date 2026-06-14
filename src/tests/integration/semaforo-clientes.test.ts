/**
 * T-131 fase B · Tests de integración de la RPC `semaforo_clientes`.
 *
 * Cobertura (contra Supabase real, como el resto de integration):
 *  - Los 3 caminos de derivación evento→cliente resuelven el cliente_id correcto:
 *    (1) informes.cliente_id, (2) epp_entrega→empleado.cliente_id, (3) accion_correctiva
 *    metadata.cliente_id directo.
 *  - Peor-estado: un vencido pinta al cliente de rojo aunque tenga otros por vencer.
 *  - Filtro status='pending': completed/cancelled no cuentan.
 *  - Bordes de bucket con p_hoy EXPLÍCITO (determinista): hoy-1=vencido, hoy y hoy+30=
 *    por_vencer, hoy+31=al_dia.
 *  - Default TZ (p_hoy NULL): un vencimiento de hoy-AR cuenta como por_vencer, NO vencido
 *    (guarda la ventana 21-24h ART; usa fecha civil AR, no CURRENT_DATE/UTC).
 *  - Metadata basura (empleado_id no-uuid): la RPC NO revienta, degrada SOLO ese evento.
 *  - Aislamiento multi-tenant: aunque la RPC sea security definer (bypassa RLS), filtra por
 *    my_consultora_ids() → cada caller ve solo sus clientes; service-role ve 0.
 *  - T-133 (L-1) anti-poisoning: eventos forjados EN el tenant propio con referencias
 *    cross-tenant (cliente_id/empleado_id en metadata, informe_id) NO filtran el cliente
 *    ajeno — cada rama re-valida el id DERIVADO contra my_consultora_ids().
 *
 * Setup SECUENCIAL (lesson T-047 — Promise.all sa-east-1 flaky).
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { todayCivilIsoAR } from '@/shared/lib/format-date';

import { createTestConsultora } from './helpers/consultora';

type SemaforoRow = Database['public']['Functions']['semaforo_clientes']['Returns'][number];

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

const slugA = `t131a-${runId}`;
const slugB = `t131b-${runId}`;
const emailOwnerA = `t131a-own-${runId}@example.com`;
const emailOwnerB = `t131b-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let ownerBId: string;

// `hoy` FIJO para los tests deterministas (p_hoy explícito). Los eventos se anclan
// a P_HOY±offset → independientes de cuándo corre CI.
const P_HOY = '2026-06-15';

// IDs de clientes capturados en el setup.
let cliInforme: string;
let cliEpp: string;
let cliAccion: string;
let cliWorst: string;
let cliStatus: string;
let cliHoy: string;
let cliMas30: string;
let cliJunk: string;
let cliToday: string;
let cliB: string;
// T-133 anti-poisoning: recursos de B referenciados por eventos forjados en A.
let cliBEmp: string;
let cliBInf: string;
// T-147 · RAR Fase 3b: rar_anual pinta el semáforo.
let cliRar: string;
let cliRarProx: string;
let cliRarJunk: string;
let cliBRar: string;

let cuitCounter = 10_000_000;
function nextCuit(): string {
  cuitCounter += 1;
  return `30-${cuitCounter.toString().padStart(8, '0')}-9`;
}
let dniCounter = 40_000_000;
function nextDni(): string {
  dniCounter += 1;
  return dniCounter.toString();
}

/** Suma `days` a una fecha civil 'YYYY-MM-DD' (sin TZ; aritmética en UTC). */
function isoPlus(baseIso: string, days: number): string {
  const [y, m, d] = baseIso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function insCliente(consultoraId: string, createdBy: string): Promise<string> {
  const { data, error } = await admin
    .from('clientes')
    .insert({
      consultora_id: consultoraId,
      razon_social: `Semáforo ${nextCuit()}`,
      cuit: nextCuit(),
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function insEvent(fields: {
  consultoraId: string;
  tipo: string;
  fecha: string;
  createdBy: string;
  metadata?: Record<string, unknown> | null;
  informeId?: string | null;
  status?: string;
}): Promise<void> {
  const { error } = await admin.from('calendar_events').insert({
    consultora_id: fields.consultoraId,
    tipo: fields.tipo,
    titulo: `Semáforo ${fields.tipo}`,
    fecha_vencimiento: fields.fecha,
    reminder_offsets_days: [],
    created_by: fields.createdBy,
    metadata: (fields.metadata ??
      null) as Database['public']['Tables']['calendar_events']['Insert']['metadata'],
    informe_id: fields.informeId ?? null,
    status: fields.status ?? 'pending',
  });
  if (error) throw error;
}

beforeAll(async () => {
  // Setup SECUENCIAL — lesson T-047 (Promise.all flaky sa-east-1).
  cAId = (await createTestConsultora(admin, { name: 'T131A', slug: slugA })).id;
  cBId = (await createTestConsultora(admin, { name: 'T131B', slug: slugB })).id;

  const { data: uOA, error: eOA } = await admin.auth.admin.createUser({
    email: emailOwnerA,
    password,
    email_confirm: true,
  });
  expect(eOA).toBeNull();
  ownerAId = uOA.user!.id;

  const { data: uOB, error: eOB } = await admin.auth.admin.createUser({
    email: emailOwnerB,
    password,
    email_confirm: true,
  });
  expect(eOB).toBeNull();
  ownerBId = uOB.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);
  await admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } });

  // --- Camino 1: informes.cliente_id (por_vencer, P_HOY+10) ---
  cliInforme = await insCliente(cAId, ownerAId);
  const { data: inf, error: eInf } = await admin
    .from('informes')
    .insert({
      consultora_id: cAId,
      tipo: 'rgrl',
      titulo: 'Semáforo informe',
      created_by: ownerAId,
      cliente_id: cliInforme,
    })
    .select('id')
    .single();
  if (eInf) throw eInf;
  await insEvent({
    consultoraId: cAId,
    tipo: 'protocolo_anual',
    fecha: isoPlus(P_HOY, 10),
    createdBy: ownerAId,
    informeId: inf.id,
  });

  // --- Camino 2: epp_entrega → empleado.cliente_id (vencido, P_HOY-1) ---
  cliEpp = await insCliente(cAId, ownerAId);
  const { data: emp, error: eEmp } = await admin
    .from('empleados')
    .insert({
      consultora_id: cAId,
      cliente_id: cliEpp,
      nombre: 'Juan',
      apellido: 'Pérez',
      dni: nextDni(),
      created_by: ownerAId,
    })
    .select('id')
    .single();
  if (eEmp) throw eEmp;
  await insEvent({
    consultoraId: cAId,
    tipo: 'epp_entrega',
    fecha: isoPlus(P_HOY, -1),
    createdBy: ownerAId,
    metadata: { empleado_id: emp.id },
  });

  // --- Camino 3: accion_correctiva metadata.cliente_id directo (al_dia, P_HOY+31) ---
  cliAccion = await insCliente(cAId, ownerAId);
  await insEvent({
    consultoraId: cAId,
    tipo: 'accion_correctiva',
    fecha: isoPlus(P_HOY, 31),
    createdBy: ownerAId,
    metadata: { cliente_id: cliAccion },
  });

  // --- Peor estado: un vencido (P_HOY-2) + un por_vencer (P_HOY+5) → vencido ---
  cliWorst = await insCliente(cAId, ownerAId);
  await insEvent({
    consultoraId: cAId,
    tipo: 'accion_correctiva',
    fecha: isoPlus(P_HOY, -2),
    createdBy: ownerAId,
    metadata: { cliente_id: cliWorst },
  });
  await insEvent({
    consultoraId: cAId,
    tipo: 'accion_correctiva',
    fecha: isoPlus(P_HOY, 5),
    createdBy: ownerAId,
    metadata: { cliente_id: cliWorst },
  });

  // --- status: un evento COMPLETED (P_HOY-5) → NO debe aparecer ---
  cliStatus = await insCliente(cAId, ownerAId);
  await insEvent({
    consultoraId: cAId,
    tipo: 'accion_correctiva',
    fecha: isoPlus(P_HOY, -5),
    createdBy: ownerAId,
    metadata: { cliente_id: cliStatus },
    status: 'completed',
  });

  // --- Bordes de bucket: P_HOY (por_vencer) y P_HOY+30 (por_vencer) ---
  cliHoy = await insCliente(cAId, ownerAId);
  await insEvent({
    consultoraId: cAId,
    tipo: 'accion_correctiva',
    fecha: P_HOY,
    createdBy: ownerAId,
    metadata: { cliente_id: cliHoy },
  });
  cliMas30 = await insCliente(cAId, ownerAId);
  await insEvent({
    consultoraId: cAId,
    tipo: 'accion_correctiva',
    fecha: isoPlus(P_HOY, 30),
    createdBy: ownerAId,
    metadata: { cliente_id: cliMas30 },
  });

  // --- Metadata basura: epp con empleado_id no-uuid (ignorado) + accion válida (P_HOY+3) ---
  cliJunk = await insCliente(cAId, ownerAId);
  await insEvent({
    consultoraId: cAId,
    tipo: 'epp_entrega',
    fecha: isoPlus(P_HOY, -1),
    createdBy: ownerAId,
    metadata: { empleado_id: 'no-es-uuid' },
  });
  await insEvent({
    consultoraId: cAId,
    tipo: 'accion_correctiva',
    fecha: isoPlus(P_HOY, 3),
    createdBy: ownerAId,
    metadata: { cliente_id: cliJunk },
  });

  // --- TZ default: evento de HOY-AR (p_hoy NULL) → por_vencer, no vencido ---
  cliToday = await insCliente(cAId, ownerAId);
  await insEvent({
    consultoraId: cAId,
    tipo: 'accion_correctiva',
    fecha: todayCivilIsoAR(),
    createdBy: ownerAId,
    metadata: { cliente_id: cliToday },
  });

  // --- Aislamiento: cliente con vencido en cB ---
  cliB = await insCliente(cBId, ownerBId);
  await insEvent({
    consultoraId: cBId,
    tipo: 'accion_correctiva',
    fecha: isoPlus(P_HOY, -1),
    createdBy: ownerBId,
    metadata: { cliente_id: cliB },
  });

  // --- T-133 anti-poisoning (L-1): eventos EN A con referencias forjadas a
  // recursos de B. Sembrados vía admin (la policy INSERT bloquea el alta
  // authenticated de tipos system; estos simulan filas pre-fix o forjadas).
  // (a) accion_correctiva con metadata.cliente_id del cliente de B.
  await insEvent({
    consultoraId: cAId,
    tipo: 'accion_correctiva',
    fecha: isoPlus(P_HOY, -1),
    createdBy: ownerAId,
    metadata: { cliente_id: cliB },
  });
  // (b) epp_entrega con metadata.empleado_id de un empleado de B.
  cliBEmp = await insCliente(cBId, ownerBId);
  const { data: empB, error: eEmpB } = await admin
    .from('empleados')
    .insert({
      consultora_id: cBId,
      cliente_id: cliBEmp,
      nombre: 'Ana',
      apellido: 'Gómez',
      dni: nextDni(),
      created_by: ownerBId,
    })
    .select('id')
    .single();
  if (eEmpB) throw eEmpB;
  await insEvent({
    consultoraId: cAId,
    tipo: 'epp_entrega',
    fecha: isoPlus(P_HOY, -1),
    createdBy: ownerAId,
    metadata: { empleado_id: empB.id },
  });
  // (c) evento con informe_id de un informe de B (sembrable: el FK de
  // calendar_events.informe_id no es compuesto por consultora).
  cliBInf = await insCliente(cBId, ownerBId);
  const { data: infB, error: eInfB } = await admin
    .from('informes')
    .insert({
      consultora_id: cBId,
      tipo: 'rgrl',
      titulo: 'Informe de B (forjable)',
      created_by: ownerBId,
      cliente_id: cliBInf,
    })
    .select('id')
    .single();
  if (eInfB) throw eInfB;
  await insEvent({
    consultoraId: cAId,
    tipo: 'protocolo_anual',
    fecha: isoPlus(P_HOY, -1),
    createdBy: ownerAId,
    informeId: infB.id,
  });

  // --- T-147 · rar_anual → metadata.cliente_id directo (molde accion_correctiva) ---
  // (a) rar_anual vencido (P_HOY-1) → vencido.
  cliRar = await insCliente(cAId, ownerAId);
  await insEvent({
    consultoraId: cAId,
    tipo: 'rar_anual',
    fecha: isoPlus(P_HOY, -1),
    createdBy: ownerAId,
    metadata: { cliente_id: cliRar, source_module: 'rar' },
  });
  // (b) rar_anual por_vencer (P_HOY+10).
  cliRarProx = await insCliente(cAId, ownerAId);
  await insEvent({
    consultoraId: cAId,
    tipo: 'rar_anual',
    fecha: isoPlus(P_HOY, 10),
    createdBy: ownerAId,
    metadata: { cliente_id: cliRarProx, source_module: 'rar' },
  });
  // (c) rar_anual con cliente_id basura (no-uuid) + uno válido (P_HOY+4): degrada solo el basura.
  cliRarJunk = await insCliente(cAId, ownerAId);
  await insEvent({
    consultoraId: cAId,
    tipo: 'rar_anual',
    fecha: isoPlus(P_HOY, -1),
    createdBy: ownerAId,
    metadata: { cliente_id: 'no-es-uuid', source_module: 'rar' },
  });
  await insEvent({
    consultoraId: cAId,
    tipo: 'rar_anual',
    fecha: isoPlus(P_HOY, 4),
    createdBy: ownerAId,
    metadata: { cliente_id: cliRarJunk, source_module: 'rar' },
  });
  // (d) anti-poisoning: rar_anual forjado EN A con cliente_id de B → A no lo ve.
  cliBRar = await insCliente(cBId, ownerBId);
  await insEvent({
    consultoraId: cAId,
    tipo: 'rar_anual',
    fecha: isoPlus(P_HOY, -1),
    createdBy: ownerAId,
    metadata: { cliente_id: cliBRar, source_module: 'rar' },
  });
});

afterAll(async () => {
  // Cleanup best-effort (CI integration corre contra DB local efímera). Orden FK-safe.
  for (const cid of [cAId, cBId]) {
    if (!cid) continue;
    await admin.from('calendar_events').delete().eq('consultora_id', cid);
    await admin.from('informes').delete().eq('consultora_id', cid);
    await admin.from('empleados').delete().eq('consultora_id', cid);
    await admin.from('clientes').delete().eq('consultora_id', cid);
  }
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerBId).catch(() => {});
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

/** Llama la RPC como el user `email` (cliente RLS, NO admin). `pHoy=null` → default SQL. */
async function semaforoAs(email: string, pHoy: string | null): Promise<SemaforoRow[]> {
  await signInAs(email);
  const { createClient: createServerClient } = await import('@/shared/supabase/server');
  const sb = await createServerClient();
  const { data, error } = await sb.rpc('semaforo_clientes', pHoy === null ? {} : { p_hoy: pHoy });
  expect(error).toBeNull();
  return data ?? [];
}

function rowFor(rows: SemaforoRow[], clienteId: string): SemaforoRow | undefined {
  return rows.find((r) => r.cliente_id === clienteId);
}

describe('semaforo_clientes RPC', () => {
  it('1. camino informes → deriva cliente_id (por_vencer)', async () => {
    const rows = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rows, cliInforme)).toMatchObject({ estado: 'por_vencer' });
  });

  it('2. camino epp_entrega → empleado.cliente_id (vencido)', async () => {
    const rows = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rows, cliEpp)).toMatchObject({ estado: 'vencido', vencidos_count: 1 });
  });

  it('3. camino accion_correctiva → metadata.cliente_id directo (al_dia)', async () => {
    const rows = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rows, cliAccion)).toMatchObject({ estado: 'al_dia' });
  });

  it('4. peor estado: un vencido pinta rojo aunque haya otro por vencer', async () => {
    const rows = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rows, cliWorst)).toMatchObject({
      estado: 'vencido',
      vencidos_count: 1,
      proximos_count: 1,
    });
  });

  it('5. status != pending (completed) no cuenta → cliente ausente', async () => {
    const rows = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rows, cliStatus)).toBeUndefined();
  });

  it('6. bordes de bucket con p_hoy explícito: hoy-1=vencido, hoy & hoy+30=por_vencer, hoy+31=al_dia', async () => {
    const rows = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rows, cliEpp)?.estado).toBe('vencido'); // P_HOY-1
    expect(rowFor(rows, cliHoy)?.estado).toBe('por_vencer'); // P_HOY (borde inferior inclusive)
    expect(rowFor(rows, cliMas30)?.estado).toBe('por_vencer'); // P_HOY+30 (borde superior inclusive)
    expect(rowFor(rows, cliAccion)?.estado).toBe('al_dia'); // P_HOY+31
  });

  it('7. metadata basura (empleado_id no-uuid) NO revienta la RPC; degrada solo ese evento', async () => {
    // semaforoAs ya asserta error===null: si el cast reventara, fallaría acá.
    const rows = await semaforoAs(emailOwnerA, P_HOY);
    // El cliente del evento VÁLIDO (accion P_HOY+3) sí aparece; el epp basura se ignoró.
    expect(rowFor(rows, cliJunk)).toMatchObject({ estado: 'por_vencer' });
  });

  it('8. default TZ (p_hoy NULL): un vencimiento de hoy-AR es por_vencer, no vencido', async () => {
    const rows = await semaforoAs(emailOwnerA, null);
    expect(rowFor(rows, cliToday)).toMatchObject({ estado: 'por_vencer', vencidos_count: 0 });
  });

  it('9. aislamiento multi-tenant: cada caller ve solo sus clientes; service-role ve 0', async () => {
    const rowsA = await semaforoAs(emailOwnerA, P_HOY);
    const rowsB = await semaforoAs(emailOwnerB, P_HOY);

    // A ve su cliente de informe; NO ve el de B. B ve el suyo; NO ve los de A.
    expect(rowFor(rowsA, cliInforme)).toBeDefined();
    expect(rowFor(rowsA, cliB)).toBeUndefined();
    expect(rowFor(rowsB, cliB)).toBeDefined();
    expect(rowFor(rowsB, cliInforme)).toBeUndefined();

    // Control negativo: service-role no tiene auth.uid() → my_consultora_ids() vacío → 0 filas.
    const { data: adminRows, error } = await admin.rpc('semaforo_clientes', { p_hoy: P_HOY });
    expect(error).toBeNull();
    expect(adminRows ?? []).toHaveLength(0);
  });
});

describe('T-133 · anti-poisoning cross-tenant (L-1)', () => {
  // Los tres eventos forjados viven EN A apuntando a recursos de B (seeds del
  // beforeAll). Pre-fix, las 3 ramas de la RPC emitían el cliente AJENO para A.
  it('10. accion_correctiva forjada con metadata.cliente_id de B → A no lo ve', async () => {
    const rowsA = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rowsA, cliB)).toBeUndefined();
  });

  it('11. epp_entrega forjado con empleado_id de B → su cliente NO aparece para A', async () => {
    const rowsA = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rowsA, cliBEmp)).toBeUndefined();
  });

  it('12. evento con informe_id de B → su cliente NO aparece para A', async () => {
    const rowsA = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rowsA, cliBInf)).toBeUndefined();
  });

  it('13. los forjados tampoco contaminan la vista de B (viven en A, fuera de su scope)', async () => {
    const rowsB = await semaforoAs(emailOwnerB, P_HOY);
    // B sigue viendo SOLO su evento legítimo (cliB, accion vencida sembrada en B).
    expect(rowFor(rowsB, cliB)).toBeDefined();
    expect(rowFor(rowsB, cliBEmp)).toBeUndefined();
    expect(rowFor(rowsB, cliBInf)).toBeUndefined();
  });
});

describe('T-147 · rama rar_anual', () => {
  it('14. rar_anual vencido pinta al cliente de rojo', async () => {
    const rows = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rows, cliRar)).toMatchObject({ estado: 'vencido', vencidos_count: 1 });
  });

  it('15. rar_anual próximo (P_HOY+10) → por_vencer', async () => {
    const rows = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rows, cliRarProx)).toMatchObject({ estado: 'por_vencer' });
  });

  it('16. rar_anual con cliente_id basura NO revienta; degrada solo ese evento', async () => {
    const rows = await semaforoAs(emailOwnerA, P_HOY);
    // El evento válido (P_HOY+4) sí pinta; el basura se ignoró sin tirar la RPC.
    expect(rowFor(rows, cliRarJunk)).toMatchObject({ estado: 'por_vencer' });
  });

  it('17. rar_anual forjado con cliente_id de B → A no lo ve (anti-poisoning)', async () => {
    const rowsA = await semaforoAs(emailOwnerA, P_HOY);
    expect(rowFor(rowsA, cliBRar)).toBeUndefined();
  });
});
