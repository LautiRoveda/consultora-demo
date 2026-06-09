/**
 * T-119 · Integration: lifecycle de planificaciones EPP.
 *
 * gen_epp_planificaciones_y_calendar_for ahora cierra la planificacion activa
 * previa del mismo (empleado,item) al reentregar (estado=cumplida + evento
 * completed + reminders skipped, completed_by NULL), deduplica items repetidos en
 * una misma entrega, y un unique parcial garantiza <=1 activa por (empleado,item).
 *
 * Cobertura:
 *  1. Reentrega del mismo (empleado,item) -> cierra la previa; queda 1 activa.
 *  2. Reentrega de OTRO item -> no toca la primera.
 *  3. Item repetido en 2 lineas de UNA entrega -> 1 sola planif (vida_util = min).
 *  4. Item descartable -> 0 planificaciones + 0 side-effects.
 *  5. El unique parcial rechaza una 2da activa (insert directo, bypass RPC) -> 23505.
 *  6. Multi-ciclo: 3 reentregas -> siempre 1 activa; la del medio cumplida.
 *  7. Audit: el cierre queda observable (after_data.estado='cumplida').
 *
 * Mismo harness que t114-epp-reminders.test.ts: service-role, 1 consultora real,
 * runId namespacing. Cada test usa items frescos -> pares (empleado,item) disjuntos
 * -> sin acoplamiento de orden entre tests.
 *
 * Correr local (Supabase efimero):
 *   pnpm test:integration src/tests/integration/t119-epp-lifecycle.test.ts
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (pnpm test:integration).',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `t119-${runId}`;
const emailOwner = `t119-own-${runId}@example.com`;

let consultoraId: string;
let ownerId: string;
let clienteId: string;
let empleadoId: string;
let categoriaId: string;

let itemSeq = 0;

// Crea un item del catalogo (default: no descartable, sin serie). Cada llamada usa
// un nombre unico -> pares (empleado,item) disjuntos entre tests.
async function seedItem(opts?: {
  vidaUtilMeses?: number;
  esDescartable?: boolean;
  requiereSerie?: boolean;
}): Promise<string> {
  itemSeq += 1;
  const item = await admin
    .from('epp_items')
    .insert({
      consultora_id: consultoraId,
      categoria_id: categoriaId,
      nombre: `T119 item ${itemSeq} ${runId}`,
      vida_util_meses: opts?.vidaUtilMeses ?? 6,
      es_descartable: opts?.esDescartable ?? false,
      requiere_numero_serie: opts?.requiereSerie ?? false,
    })
    .select('id')
    .single();
  if (item.error || !item.data) throw new Error(`insert item: ${JSON.stringify(item.error)}`);
  return item.data.id;
}

type Linea = { itemId: string; override?: number; numeroSerie?: string };

// Crea entrega + sus lineas (NO invoca la RPC). Devuelve el id de entrega.
async function seedEntrega(fechaEntregaIso: string, lineas: Linea[]): Promise<string> {
  const entrega = await admin
    .from('epp_entregas')
    .insert({
      consultora_id: consultoraId,
      empleado_id: empleadoId,
      cliente_id: clienteId,
      fecha_entrega: fechaEntregaIso,
      created_by: ownerId,
    })
    .select('id')
    .single();
  if (entrega.error || !entrega.data)
    throw new Error(`insert entrega: ${JSON.stringify(entrega.error)}`);

  for (const l of lineas) {
    const ei = await admin.from('epp_entrega_items').insert({
      entrega_id: entrega.data.id,
      item_id: l.itemId,
      consultora_id: consultoraId,
      cantidad: 1,
      motivo_entrega: 'inicial',
      ...(l.override !== undefined ? { vida_util_meses_override: l.override } : {}),
      ...(l.numeroSerie !== undefined ? { numero_serie: l.numeroSerie } : {}),
    });
    if (ei.error) throw new Error(`insert entrega_item: ${JSON.stringify(ei.error)}`);
  }
  return entrega.data.id;
}

// Crea entrega + lineas + invoca la RPC (assert sin error). Devuelve el id.
async function seedEntregaYGenerar(fechaEntregaIso: string, lineas: Linea[]): Promise<string> {
  const entregaId = await seedEntrega(fechaEntregaIso, lineas);
  const rpc = await admin.rpc('gen_epp_planificaciones_y_calendar_for', {
    p_entrega_id: entregaId,
  });
  expect(rpc.error).toBeNull();
  return entregaId;
}

async function planifsActivas(itemId: string) {
  const { data, error } = await admin
    .from('epp_planificaciones')
    .select('id, generado_de_entrega_id, frecuencia_meses, estado')
    .eq('empleado_id', empleadoId)
    .eq('item_id', itemId)
    .eq('estado', 'activa');
  expect(error).toBeNull();
  return data ?? [];
}

async function planifByEntrega(entregaId: string) {
  const { data, error } = await admin
    .from('epp_planificaciones')
    .select('id, estado, calendar_event_id, frecuencia_meses')
    .eq('generado_de_entrega_id', entregaId)
    .single();
  expect(error).toBeNull();
  return data!;
}

beforeAll(async () => {
  const c = await admin.from('consultoras').insert({ name: 'T119', slug }).select('id').single();
  if (c.error || !c.data) throw new Error(`insert consultora: ${JSON.stringify(c.error)}`);
  consultoraId = c.data.id;

  const u = await admin.auth.admin.createUser({
    email: emailOwner,
    password: 'TestPassword123!',
    email_confirm: true,
  });
  if (u.error || !u.data.user) throw new Error(`createUser: ${JSON.stringify(u.error)}`);
  ownerId = u.data.user.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: consultoraId, role: 'owner' });

  const cli = await admin
    .from('clientes')
    .insert({
      consultora_id: consultoraId,
      razon_social: `T119 cli ${runId}`,
      cuit: '30-12345678-9',
    })
    .select('id')
    .single();
  if (cli.error || !cli.data) throw new Error(`insert cliente: ${JSON.stringify(cli.error)}`);
  clienteId = cli.data.id;

  const emp = await admin
    .from('empleados')
    .insert({
      consultora_id: consultoraId,
      cliente_id: clienteId,
      nombre: 'T119',
      apellido: 'EPP',
      dni: '30123456',
    })
    .select('id')
    .single();
  if (emp.error || !emp.data) throw new Error(`insert empleado: ${JSON.stringify(emp.error)}`);
  empleadoId = emp.data.id;

  const cat = await admin
    .from('epp_categorias')
    .insert({ consultora_id: consultoraId, nombre: `T119 cat ${runId}` })
    .select('id')
    .single();
  if (cat.error || !cat.data) throw new Error(`insert categoria: ${JSON.stringify(cat.error)}`);
  categoriaId = cat.data.id;
});

afterAll(async () => {
  // Cleanup best-effort en orden FK inverso (swallow: el reset efimero del runner
  // limpia lo que quede; epp_entregas son evidencia y el audit_log es append-only).
  await admin
    .from('epp_planificaciones')
    .delete()
    .eq('consultora_id', consultoraId)
    .then(() => {});
  await admin
    .from('epp_entregas')
    .delete()
    .eq('consultora_id', consultoraId)
    .then(() => {});
  await admin
    .from('calendar_events')
    .delete()
    .eq('consultora_id', consultoraId)
    .then(() => {});
  await admin
    .from('epp_items')
    .delete()
    .eq('consultora_id', consultoraId)
    .then(() => {});
  await admin
    .from('epp_categorias')
    .delete()
    .eq('consultora_id', consultoraId)
    .then(() => {});
  await admin
    .from('empleados')
    .delete()
    .eq('consultora_id', consultoraId)
    .then(() => {});
  await admin
    .from('clientes')
    .delete()
    .eq('consultora_id', consultoraId)
    .then(() => {});
  await admin
    .from('consultora_members')
    .delete()
    .eq('consultora_id', consultoraId)
    .then(() => {});
  await admin
    .from('consultoras')
    .delete()
    .eq('id', consultoraId)
    .then(() => {});
  await admin.auth.admin.deleteUser(ownerId).catch(() => {});
});

describe('T-119 · cierre de la planificacion previa al reentregar', () => {
  it('1. reentrega del mismo (empleado,item) -> previa cumplida + evento completed + reminders skipped; queda 1 activa', async () => {
    const itemId = await seedItem({ vidaUtilMeses: 6 });

    // Entrega 1: fecha 2026-05-01 + 6m -> vencimiento 2026-11-01 (futuro) -> 3 reminders pending.
    const entrega1 = await seedEntregaYGenerar('2026-05-01T12:00:00Z', [{ itemId }]);
    const planif1 = await planifByEntrega(entrega1);
    expect(planif1.estado).toBe('activa');
    const event1Id = planif1.calendar_event_id!;
    expect(event1Id).not.toBeNull();

    const remindersBefore = await admin
      .from('calendar_event_reminders')
      .select('status')
      .eq('event_id', event1Id);
    expect((remindersBefore.data ?? []).length).toBeGreaterThanOrEqual(1);
    expect((remindersBefore.data ?? []).every((r) => r.status === 'pending')).toBe(true);

    // Entrega 2: misma (empleado,item) -> debe cerrar la planif1.
    const entrega2 = await seedEntregaYGenerar('2026-06-01T12:00:00Z', [{ itemId }]);

    // planif1 quedo cumplida.
    const planif1After = await planifByEntrega(entrega1);
    expect(planif1After.estado).toBe('cumplida');

    // su calendar_event quedo completed, completed_at seteado, completed_by NULL.
    const ev1 = await admin
      .from('calendar_events')
      .select('status, completed_at, completed_by')
      .eq('id', event1Id)
      .single();
    expect(ev1.data?.status).toBe('completed');
    expect(ev1.data?.completed_at).not.toBeNull();
    expect(ev1.data?.completed_by).toBeNull();

    // sus reminders: todos skipped, ninguno pending (count-agnostic: T-114 omite offsets pasados).
    const remindersAfter = await admin
      .from('calendar_event_reminders')
      .select('status')
      .eq('event_id', event1Id);
    expect((remindersAfter.data ?? []).length).toBe((remindersBefore.data ?? []).length);
    expect((remindersAfter.data ?? []).every((r) => r.status === 'skipped')).toBe(true);

    // queda EXACTAMENTE 1 activa para el par, y es la de entrega2.
    const activas = await planifsActivas(itemId);
    expect(activas).toHaveLength(1);
    expect(activas[0]!.generado_de_entrega_id).toBe(entrega2);
  });

  it('2. reentrega de OTRO item del mismo empleado no cierra la del primero', async () => {
    const itemA = await seedItem({ vidaUtilMeses: 6 });
    const itemB = await seedItem({ vidaUtilMeses: 12 });

    const entregaA = await seedEntregaYGenerar('2026-05-10T12:00:00Z', [{ itemId: itemA }]);
    await seedEntregaYGenerar('2026-05-11T12:00:00Z', [{ itemId: itemB }]);

    // itemA sigue con su unica activa (la de entregaA); itemB tiene la suya.
    const activasA = await planifsActivas(itemA);
    expect(activasA).toHaveLength(1);
    expect(activasA[0]!.generado_de_entrega_id).toBe(entregaA);
    expect(activasA[0]!.estado).toBe('activa');

    const activasB = await planifsActivas(itemB);
    expect(activasB).toHaveLength(1);
  });
});

describe('T-119 · dedup de items repetidos en una entrega', () => {
  it('3. mismo item en 2 lineas de UNA entrega -> 1 sola planificacion activa (vida_util = min override)', async () => {
    const itemId = await seedItem({ vidaUtilMeses: 24 });

    // Dos lineas del mismo item con overrides 12 y 6 -> dedup -> 1 planif, frecuencia = min = 6.
    const entrega = await seedEntregaYGenerar('2026-05-15T12:00:00Z', [
      { itemId, override: 12 },
      { itemId, override: 6 },
    ]);

    const activas = await planifsActivas(itemId);
    expect(activas).toHaveLength(1);
    expect(activas[0]!.generado_de_entrega_id).toBe(entrega);
    expect(activas[0]!.frecuencia_meses).toBe(6);

    // Un solo calendar_event epp_entrega para esta entrega.
    const { data: events } = await admin
      .from('calendar_events')
      .select('id')
      .eq('consultora_id', consultoraId)
      .eq('tipo', 'epp_entrega')
      .contains('metadata', { epp_entrega_id: entrega });
    expect((events ?? []).length).toBe(1);
  });
});

describe('T-119 · item descartable no genera ni cierra nada', () => {
  it('4. entrega con SOLO item descartable -> 0 planificaciones + activa previa intacta', async () => {
    const itemNoDesc = await seedItem({ vidaUtilMeses: 6 });
    const itemDesc = await seedItem({ esDescartable: true });

    // Activa previa de un item NO descartable.
    const entregaNoDesc = await seedEntregaYGenerar('2026-05-20T12:00:00Z', [
      { itemId: itemNoDesc },
    ]);
    expect(await planifsActivas(itemNoDesc)).toHaveLength(1);

    // Entrega con solo el descartable -> 0 planificaciones / 0 eventos.
    const entregaDesc = await seedEntregaYGenerar('2026-05-21T12:00:00Z', [{ itemId: itemDesc }]);

    const { data: planifsDesc } = await admin
      .from('epp_planificaciones')
      .select('id')
      .eq('generado_de_entrega_id', entregaDesc);
    expect((planifsDesc ?? []).length).toBe(0);

    const { data: eventsDesc } = await admin
      .from('calendar_events')
      .select('id')
      .eq('consultora_id', consultoraId)
      .eq('tipo', 'epp_entrega')
      .contains('metadata', { epp_entrega_id: entregaDesc });
    expect((eventsDesc ?? []).length).toBe(0);

    // La activa del item no descartable sigue intacta (la entrega descartable no la cerro).
    const activas = await planifsActivas(itemNoDesc);
    expect(activas).toHaveLength(1);
    expect(activas[0]!.generado_de_entrega_id).toBe(entregaNoDesc);
  });
});

describe('T-119 · unique parcial uq_epp_planif_activa_empleado_item', () => {
  it('5. una 2da activa para el mismo (empleado,item) via insert directo -> 23505', async () => {
    const itemId = await seedItem({ vidaUtilMeses: 6 });
    // generado_de_entrega_id es NOT NULL + FK RESTRICT -> necesito una entrega real.
    const entregaId = await seedEntrega('2026-05-25T12:00:00Z', [{ itemId }]);

    const base = {
      consultora_id: consultoraId,
      empleado_id: empleadoId,
      item_id: itemId,
      fecha_proxima_entrega: '2026-11-25T12:00:00Z',
      frecuencia_meses: 6,
      generado_de_entrega_id: entregaId,
      estado: 'activa' as const,
    };

    const first = await admin.from('epp_planificaciones').insert(base);
    expect(first.error).toBeNull();

    const second = await admin.from('epp_planificaciones').insert(base);
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe('23505');
  });
});

describe('T-119 · multi-ciclo (idempotencia del cierre)', () => {
  it('6. tres reentregas del mismo (empleado,item) -> siempre 1 activa; la del medio cumplida', async () => {
    const itemId = await seedItem({ vidaUtilMeses: 6 });

    const e1 = await seedEntregaYGenerar('2026-04-01T12:00:00Z', [{ itemId }]);
    const e2 = await seedEntregaYGenerar('2026-05-01T12:00:00Z', [{ itemId }]);
    const e3 = await seedEntregaYGenerar('2026-06-01T12:00:00Z', [{ itemId }]);

    // Solo e3 queda activa.
    const activas = await planifsActivas(itemId);
    expect(activas).toHaveLength(1);
    expect(activas[0]!.generado_de_entrega_id).toBe(e3);

    // e1 y e2 quedaron cumplidas.
    expect((await planifByEntrega(e1)).estado).toBe('cumplida');
    expect((await planifByEntrega(e2)).estado).toBe('cumplida');
  });
});

describe('T-119 · audit del cierre', () => {
  it('7. el cierre por reentrega queda en audit_log (after_data.estado=cumplida)', async () => {
    const itemId = await seedItem({ vidaUtilMeses: 6 });
    const e1 = await seedEntregaYGenerar('2026-04-10T12:00:00Z', [{ itemId }]);
    const planif1 = await planifByEntrega(e1);
    await seedEntregaYGenerar('2026-05-10T12:00:00Z', [{ itemId }]);

    const { data: audit } = await admin
      .from('audit_log')
      .select('action, after_data')
      .eq('entity_type', 'epp_planificaciones')
      .eq('entity_id', planif1.id)
      .eq('action', 'updated');

    const cerrado = (audit ?? []).some(
      (a) => (a.after_data as { estado?: string } | null)?.estado === 'cumplida',
    );
    expect(cerrado).toBe(true);
  });
});
