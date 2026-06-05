/**
 * T-123 · Integration: skip de reminders al finalizar un evento (trigger AFTER UPDATE).
 *
 * El trigger skip_reminders_on_event_final_after_update skipea los reminders
 * 'pending' de un calendar_event cuando este pasa a final (completed/cancelled),
 * a nivel DB, cubriendo TODO camino (incluido UPDATE directo SQL/service-role que
 * NO pasa por una server action).
 *
 * Cobertura:
 *  1. UPDATE directo -> completed  -> reminders pending -> skipped (lo NUEVO).
 *  2. UPDATE directo -> cancelled  -> reminders pending -> skipped.
 *  3. Solo toca 'pending': un reminder 'sent' previo queda intacto.
 *  4. WHEN negativo: editar titulo/fecha (sin status) NO skipea.
 *  5. WHEN negativo: final->final (completed->cancelled) NO dispara (old.status != 'pending').
 *  6. Cross-tenant: completar el evento de A no toca los reminders de B.
 *  7. No-conflicto T-118: completar un epp_entrega propaga al dominio (planif cumplida)
 *     Y skipea los reminders en el mismo UPDATE.
 *
 * Mismo harness que t118-sync-calendar-to-origin.test.ts: service-role admin, runId
 * namespacing, seeds frescos por test.
 *
 * Correr local (Supabase efimero, requiere Docker):
 *   pnpm test:integration src/tests/integration/t123-skip-reminders-on-event-final.test.ts
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

// YYYY-MM-DD -> instante 12:00 UTC (scheduled_at de los reminders; el valor no es
// material para el skip, que solo filtra por status='pending').
function noonUtcIso(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toISOString();
}

type Tenant = {
  consultoraId: string;
  ownerId: string;
  clienteId: string;
  empleadoId: string;
  categoriaId: string;
};

let A: Tenant;
let B: Tenant;

let seq = 0;
function nextSeq(): number {
  seq += 1;
  return seq;
}

// -- Seed generico: calendar_event (status configurable) + N reminders pending ----

async function seedEventWithReminders(
  t: Tenant,
  opts: {
    status?: Database['public']['Tables']['calendar_events']['Row']['status'];
    tipo?: Database['public']['Tables']['calendar_events']['Row']['tipo'];
    offsets?: number[];
    fechaVencimiento?: string;
  } = {},
): Promise<{ eventId: string; reminderIds: string[] }> {
  const n = nextSeq();
  const status = opts.status ?? 'pending';
  const offsets = opts.offsets ?? [14, 3, 0];
  const fechaVencimiento = opts.fechaVencimiento ?? '2027-01-15';

  const ev = await admin
    .from('calendar_events')
    .insert({
      consultora_id: t.consultoraId,
      tipo: opts.tipo ?? 'custom',
      titulo: `T123 ev ${n} ${runId}`,
      fecha_vencimiento: fechaVencimiento,
      reminder_offsets_days: offsets,
      status,
      created_by: t.ownerId,
    })
    .select('id')
    .single();
  if (ev.error || !ev.data) throw new Error(`insert event: ${JSON.stringify(ev.error)}`);

  const rows = offsets.map((offset_days) => ({
    event_id: ev.data.id,
    consultora_id: t.consultoraId,
    offset_days,
    scheduled_at: noonUtcIso(fechaVencimiento),
    status: 'pending' as const,
  }));
  const ins = await admin.from('calendar_event_reminders').insert(rows).select('id');
  if (ins.error || !ins.data) throw new Error(`insert reminders: ${JSON.stringify(ins.error)}`);

  return { eventId: ev.data.id, reminderIds: ins.data.map((r) => r.id) };
}

async function reminderStatuses(eventId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('calendar_event_reminders')
    .select('status')
    .eq('event_id', eventId);
  expect(error).toBeNull();
  return (data ?? []).map((r) => r.status);
}

async function patchEvent(
  eventId: string,
  patch: Database['public']['Tables']['calendar_events']['Update'],
): Promise<void> {
  const { error } = await admin.from('calendar_events').update(patch).eq('id', eventId);
  expect(error).toBeNull();
}

// -- Seed EPP (para el test de no-conflicto con T-118) ------------------------

async function seedItem(t: Tenant, vidaUtilMeses = 6): Promise<string> {
  const n = nextSeq();
  const item = await admin
    .from('epp_items')
    .insert({
      consultora_id: t.consultoraId,
      categoria_id: t.categoriaId,
      nombre: `T123 item ${n} ${runId}`,
      vida_util_meses: vidaUtilMeses,
      es_descartable: false,
      requiere_numero_serie: false,
    })
    .select('id')
    .single();
  if (item.error || !item.data) throw new Error(`insert item: ${JSON.stringify(item.error)}`);
  return item.data.id;
}

async function seedEntrega(t: Tenant, fechaEntregaIso: string, itemId: string): Promise<string> {
  const entrega = await admin
    .from('epp_entregas')
    .insert({
      consultora_id: t.consultoraId,
      empleado_id: t.empleadoId,
      cliente_id: t.clienteId,
      fecha_entrega: fechaEntregaIso,
      created_by: t.ownerId,
    })
    .select('id')
    .single();
  if (entrega.error || !entrega.data)
    throw new Error(`insert entrega: ${JSON.stringify(entrega.error)}`);

  const ei = await admin.from('epp_entrega_items').insert({
    entrega_id: entrega.data.id,
    item_id: itemId,
    consultora_id: t.consultoraId,
    cantidad: 1,
    motivo_entrega: 'inicial',
  });
  if (ei.error) throw new Error(`insert entrega_item: ${JSON.stringify(ei.error)}`);
  return entrega.data.id;
}

async function seedEppPlanif(t: Tenant) {
  const itemId = await seedItem(t, 6);
  const entregaId = await seedEntrega(t, '2026-05-01T12:00:00Z', itemId);
  const rpc = await admin.rpc('gen_epp_planificaciones_y_calendar_for', {
    p_entrega_id: entregaId,
  });
  expect(rpc.error).toBeNull();

  const { data: planif, error } = await admin
    .from('epp_planificaciones')
    .select('id, estado, calendar_event_id')
    .eq('generado_de_entrega_id', entregaId)
    .single();
  expect(error).toBeNull();
  expect(planif!.estado).toBe('activa');
  expect(planif!.calendar_event_id).not.toBeNull();
  return { planifId: planif!.id, eventId: planif!.calendar_event_id! };
}

async function planifEstado(planifId: string): Promise<string> {
  const { data, error } = await admin
    .from('epp_planificaciones')
    .select('estado')
    .eq('id', planifId)
    .single();
  expect(error).toBeNull();
  return data!.estado;
}

// -- Setup tenants ------------------------------------------------------------

async function seedTenant(label: string, dni: string, cuit: string): Promise<Tenant> {
  const c = await admin
    .from('consultoras')
    .insert({ name: label, slug: `${label.toLowerCase()}-${runId}` })
    .select('id')
    .single();
  if (c.error || !c.data) throw new Error(`insert consultora ${label}: ${JSON.stringify(c.error)}`);
  const consultoraId = c.data.id;

  const u = await admin.auth.admin.createUser({
    email: `${label.toLowerCase()}-own-${runId}@example.com`,
    password: 'TestPassword123!',
    email_confirm: true,
  });
  if (u.error || !u.data.user) throw new Error(`createUser ${label}: ${JSON.stringify(u.error)}`);
  const ownerId = u.data.user.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: consultoraId, role: 'owner' });

  const cli = await admin
    .from('clientes')
    .insert({ consultora_id: consultoraId, razon_social: `${label} cli ${runId}`, cuit })
    .select('id')
    .single();
  if (cli.error || !cli.data)
    throw new Error(`insert cliente ${label}: ${JSON.stringify(cli.error)}`);

  const emp = await admin
    .from('empleados')
    .insert({
      consultora_id: consultoraId,
      cliente_id: cli.data.id,
      nombre: label,
      apellido: 'EPP',
      dni,
    })
    .select('id')
    .single();
  if (emp.error || !emp.data)
    throw new Error(`insert empleado ${label}: ${JSON.stringify(emp.error)}`);

  const cat = await admin
    .from('epp_categorias')
    .insert({ consultora_id: consultoraId, nombre: `${label} cat ${runId}` })
    .select('id')
    .single();
  if (cat.error || !cat.data)
    throw new Error(`insert categoria ${label}: ${JSON.stringify(cat.error)}`);

  return {
    consultoraId,
    ownerId,
    clienteId: cli.data.id,
    empleadoId: emp.data.id,
    categoriaId: cat.data.id,
  };
}

beforeAll(async () => {
  A = await seedTenant('T123A', '30333333', '30-33333333-9');
  B = await seedTenant('T123B', '30444444', '30-44444444-9');
});

afterAll(async () => {
  // Best-effort en orden FK inverso (el reset efimero del runner limpia el resto).
  for (const t of [A, B]) {
    if (!t) continue;
    const id = t.consultoraId;
    await admin
      .from('calendar_event_reminders')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('epp_planificaciones')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('calendar_events')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('epp_entrega_items')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('epp_entregas')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('epp_items')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('epp_categorias')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('empleados')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('clientes')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('consultora_members')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('consultoras')
      .delete()
      .eq('id', id)
      .then(() => {});
    await admin.auth.admin.deleteUser(t.ownerId).catch(() => {});
  }
});

describe('T-123 · UPDATE directo -> trigger skipea (cubre caminos no-action)', () => {
  it('1. completar el evento por UPDATE directo -> reminders pending pasan a skipped', async () => {
    const { eventId } = await seedEventWithReminders(A);
    expect((await reminderStatuses(eventId)).every((s) => s === 'pending')).toBe(true);

    await patchEvent(eventId, { status: 'completed', completed_at: new Date().toISOString() });

    const statuses = await reminderStatuses(eventId);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((s) => s === 'skipped')).toBe(true);
  });

  it('2. cancelar el evento por UPDATE directo -> reminders pending pasan a skipped', async () => {
    const { eventId } = await seedEventWithReminders(A);

    await patchEvent(eventId, { status: 'cancelled' });

    expect((await reminderStatuses(eventId)).every((s) => s === 'skipped')).toBe(true);
  });

  it('3. solo toca pending: un reminder ya sent queda intacto', async () => {
    const { eventId, reminderIds } = await seedEventWithReminders(A);
    // Marcar 1 reminder como 'sent' (claim previo del cron): el trigger no debe tocarlo.
    await admin
      .from('calendar_event_reminders')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', reminderIds[0]!);

    await patchEvent(eventId, { status: 'completed', completed_at: new Date().toISOString() });

    const statuses = await reminderStatuses(eventId);
    expect(statuses.filter((s) => s === 'sent')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'skipped')).toHaveLength(reminderIds.length - 1);
    expect(statuses).not.toContain('pending');
  });
});

describe('T-123 · WHEN clause negativo', () => {
  it('4. editar titulo/fecha (sin tocar status) NO skipea', async () => {
    const { eventId } = await seedEventWithReminders(A);

    await patchEvent(eventId, { titulo: `Editado ${runId}` });
    expect((await reminderStatuses(eventId)).every((s) => s === 'pending')).toBe(true);

    await patchEvent(eventId, { fecha_vencimiento: '2028-02-02' });
    expect((await reminderStatuses(eventId)).every((s) => s === 'pending')).toBe(true);
  });

  it('5. final->final (completed->cancelled) NO dispara (old.status != pending)', async () => {
    // Evento sembrado YA completed con un reminder pending zombie (caso del backfill).
    const { eventId } = await seedEventWithReminders(A, { status: 'completed' });
    expect((await reminderStatuses(eventId)).every((s) => s === 'pending')).toBe(true);

    await patchEvent(eventId, { status: 'cancelled' });

    // El trigger no dispara: old.status='completed' != 'pending'. El zombie sigue pending
    // (lo limpia el backfill de la migracion, no el trigger).
    expect((await reminderStatuses(eventId)).every((s) => s === 'pending')).toBe(true);
  });
});

describe('T-123 · cross-tenant', () => {
  it('6. completar el evento de A no toca los reminders de B', async () => {
    const a = await seedEventWithReminders(A);
    const b = await seedEventWithReminders(B);

    await patchEvent(a.eventId, { status: 'completed', completed_at: new Date().toISOString() });

    expect((await reminderStatuses(a.eventId)).every((s) => s === 'skipped')).toBe(true);
    expect((await reminderStatuses(b.eventId)).every((s) => s === 'pending')).toBe(true);
  });
});

describe('T-123 · no-conflicto con T-118', () => {
  it('7. completar un epp_entrega propaga al dominio (planif cumplida) Y skipea reminders', async () => {
    const { planifId, eventId } = await seedEppPlanif(A);
    const antes = await reminderStatuses(eventId);
    expect(antes.length).toBeGreaterThan(0);
    expect(antes.every((s) => s === 'pending')).toBe(true);

    await patchEvent(eventId, { status: 'completed', completed_at: new Date().toISOString() });

    // T-118: planif -> cumplida. T-123: reminders -> skipped. Ambos en el mismo UPDATE.
    expect(await planifEstado(planifId)).toBe('cumplida');
    expect((await reminderStatuses(eventId)).every((s) => s === 'skipped')).toBe(true);
  });
});
