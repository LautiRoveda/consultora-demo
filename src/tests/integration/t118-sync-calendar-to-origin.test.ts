/**
 * T-118 · Integration: sincronización calendario -> dominio (trigger AFTER UPDATE).
 *
 * El trigger sync_calendar_event_to_origin_after_update propaga edits de fecha y
 * status de calendar_events al dominio que leen chat/ficha/padron:
 *   epp_entrega       -> epp_planificaciones (fecha_proxima_entrega @ 12:00 UTC,
 *                        estado cumplida/cancelada)
 *   accion_correctiva -> acciones_correctivas (fecha_compromiso date,
 *                        estado cerrada/anulada + cerrada_at)
 *
 * Cobertura:
 *  1. EPP editar fecha       -> fecha_proxima_entrega = nueva fecha @ 12:00 UTC.
 *  2. EPP completar          -> estado=cumplida; fecha NO reescrita (fix I-1).
 *  3. EPP cancelar           -> estado=cancelada.
 *  4. WHEN clause negativo   -> editar titulo (sin fecha/status) NO toca el dominio.
 *  5. No-conflicto T-119     -> reentrega deja 1 activa; el trigger no rompe el cierre.
 *  6. Idempotencia           -> re-aplicar la misma fecha = no-op (sin audit extra).
 *  7. Cross-tenant           -> editar evento de A no toca la planif de B.
 *  8. Guard final            -> editar fecha de evento cuya planif ya esta cumplida = no-op.
 *  9. CAPA editar fecha      -> fecha_compromiso = nueva fecha.
 * 10. CAPA completar         -> estado=cerrada + cerrada_at.
 * 11. CAPA cancelar          -> estado=anulada.
 *
 * Mismo harness que t119-epp-lifecycle.test.ts: service-role admin, runId
 * namespacing, items frescos por test (pares disjuntos -> sin acoplamiento de orden).
 *
 * Correr local (Supabase efimero, requiere Docker):
 *   pnpm test:integration src/tests/integration/t118-sync-calendar-to-origin.test.ts
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

// Espejo local de computeScheduledAtUtc (offset 0): YYYY-MM-DD -> instante 12:00 UTC.
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

// -- Seeds EPP (parametrizados por tenant) ------------------------------------

async function seedItem(t: Tenant, vidaUtilMeses = 6): Promise<string> {
  const n = nextSeq();
  const item = await admin
    .from('epp_items')
    .insert({
      consultora_id: t.consultoraId,
      categoria_id: t.categoriaId,
      nombre: `T118 item ${n} ${runId}`,
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

async function genEpp(entregaId: string): Promise<void> {
  const rpc = await admin.rpc('gen_epp_planificaciones_y_calendar_for', {
    p_entrega_id: entregaId,
  });
  expect(rpc.error).toBeNull();
}

async function planifByEntrega(entregaId: string) {
  const { data, error } = await admin
    .from('epp_planificaciones')
    .select('id, estado, calendar_event_id, fecha_proxima_entrega, updated_at')
    .eq('generado_de_entrega_id', entregaId)
    .single();
  expect(error).toBeNull();
  return data!;
}

async function planifById(planifId: string) {
  const { data, error } = await admin
    .from('epp_planificaciones')
    .select('id, estado, calendar_event_id, fecha_proxima_entrega, updated_at')
    .eq('id', planifId)
    .single();
  expect(error).toBeNull();
  return data!;
}

async function activasCount(t: Tenant, itemId: string): Promise<number> {
  const { data, error } = await admin
    .from('epp_planificaciones')
    .select('id, generado_de_entrega_id')
    .eq('empleado_id', t.empleadoId)
    .eq('item_id', itemId)
    .eq('estado', 'activa');
  expect(error).toBeNull();
  return (data ?? []).length;
}

// Seed completo: item + entrega + RPC -> { planif, eventId } (1 activa lista para editar).
async function seedEppPlanif(
  t: Tenant,
  fechaEntregaIso = '2026-05-01T12:00:00Z',
  vidaUtilMeses = 6,
) {
  const itemId = await seedItem(t, vidaUtilMeses);
  const entregaId = await seedEntrega(t, fechaEntregaIso, itemId);
  await genEpp(entregaId);
  const planif = await planifByEntrega(entregaId);
  expect(planif.estado).toBe('activa');
  expect(planif.calendar_event_id).not.toBeNull();
  return { itemId, entregaId, planifId: planif.id, eventId: planif.calendar_event_id!, planif };
}

// -- Seeds CAPA (tenant A) ----------------------------------------------------

async function seedCapa(fechaCompromiso: string) {
  const n = nextSeq();
  const tpl = await admin
    .from('checklist_templates')
    .insert({ consultora_id: A.consultoraId, nombre: `T118 tpl ${n} ${runId}` })
    .select('id')
    .single();
  if (tpl.error || !tpl.data) throw new Error(`insert template: ${JSON.stringify(tpl.error)}`);

  const ver = await admin
    .from('checklist_template_versions')
    .insert({
      template_id: tpl.data.id,
      consultora_id: A.consultoraId,
      version_number: 1,
      estado: 'published',
    })
    .select('id')
    .single();
  if (ver.error || !ver.data) throw new Error(`insert version: ${JSON.stringify(ver.error)}`);

  const exec = await admin
    .from('checklist_executions')
    .insert({
      consultora_id: A.consultoraId,
      template_version_id: ver.data.id,
      cliente_id: A.clienteId,
      created_by: A.ownerId,
    })
    .select('id')
    .single();
  if (exec.error || !exec.data) throw new Error(`insert execution: ${JSON.stringify(exec.error)}`);

  const acc = await admin
    .from('acciones_correctivas')
    .insert({
      consultora_id: A.consultoraId,
      execution_id: exec.data.id,
      cliente_id: A.clienteId,
      descripcion: `Reparar extintor vencido ${n}`,
      fecha_compromiso: fechaCompromiso,
      estado: 'abierta',
    })
    .select('id')
    .single();
  if (acc.error || !acc.data) throw new Error(`insert accion: ${JSON.stringify(acc.error)}`);

  const rpc = await admin.rpc('gen_acciones_calendar_for', { p_execution_id: exec.data.id });
  expect(rpc.error).toBeNull();

  const linked = await admin
    .from('acciones_correctivas')
    .select('id, calendar_event_id, estado, fecha_compromiso, cerrada_at')
    .eq('id', acc.data.id)
    .single();
  expect(linked.error).toBeNull();
  expect(linked.data!.calendar_event_id).not.toBeNull();
  return { accionId: acc.data.id, eventId: linked.data!.calendar_event_id! };
}

async function accionById(accionId: string) {
  const { data, error } = await admin
    .from('acciones_correctivas')
    .select('id, estado, fecha_compromiso, cerrada_at, updated_at')
    .eq('id', accionId)
    .single();
  expect(error).toBeNull();
  return data!;
}

// -- Helpers comunes ----------------------------------------------------------

async function patchEvent(
  eventId: string,
  patch: Database['public']['Tables']['calendar_events']['Update'],
): Promise<void> {
  const { error } = await admin.from('calendar_events').update(patch).eq('id', eventId);
  expect(error).toBeNull();
}

async function auditUpdatedCount(entityType: string, entityId: string): Promise<number> {
  const { data } = await admin
    .from('audit_log')
    .select('id')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('action', 'updated');
  return (data ?? []).length;
}

// -- Setup tenants A y B ------------------------------------------------------

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
  A = await seedTenant('T118A', '30111111', '30-11111111-9');
  B = await seedTenant('T118B', '30222222', '30-22222222-9');
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
      .from('acciones_correctivas')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('execution_respuestas')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('checklist_executions')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('checklist_template_versions')
      .delete()
      .eq('consultora_id', id)
      .then(() => {});
    await admin
      .from('checklist_templates')
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

describe('T-118 · EPP: epp_entrega -> epp_planificaciones', () => {
  it('1. editar fecha del evento -> fecha_proxima_entrega = nueva fecha @ 12:00 UTC', async () => {
    const { planifId, eventId } = await seedEppPlanif(A);

    await patchEvent(eventId, { fecha_vencimiento: '2027-03-15' });

    const planif = await planifById(planifId);
    expect(new Date(planif.fecha_proxima_entrega).toISOString()).toBe(noonUtcIso('2027-03-15'));
    expect(planif.estado).toBe('activa');
  });

  it('2. completar el evento -> estado=cumplida; la fecha NO se reescribe (fix I-1)', async () => {
    const { planifId, eventId, planif } = await seedEppPlanif(A);
    const fechaAntes = planif.fecha_proxima_entrega;

    await patchEvent(eventId, { status: 'completed', completed_at: new Date().toISOString() });

    const after = await planifById(planifId);
    expect(after.estado).toBe('cumplida');
    // status-only change -> fecha intacta (no normalizada a 12:00 UTC).
    expect(new Date(after.fecha_proxima_entrega).getTime()).toBe(new Date(fechaAntes).getTime());
  });

  it('3. cancelar el evento -> estado=cancelada', async () => {
    const { planifId, eventId } = await seedEppPlanif(A);

    await patchEvent(eventId, { status: 'cancelled' });

    expect((await planifById(planifId)).estado).toBe('cancelada');
  });

  it('4. WHEN clause: editar titulo (sin fecha/status) NO toca el dominio', async () => {
    const { planifId, eventId } = await seedEppPlanif(A);
    const before = await planifById(planifId);
    const auditBefore = await auditUpdatedCount('epp_planificaciones', planifId);

    await patchEvent(eventId, { titulo: `Editado ${runId}` });

    const after = await planifById(planifId);
    expect(after.estado).toBe(before.estado);
    expect(new Date(after.fecha_proxima_entrega).getTime()).toBe(
      new Date(before.fecha_proxima_entrega).getTime(),
    );
    // El trigger no disparo -> sin UPDATE en la planif -> updated_at intacto + sin audit nuevo.
    expect(after.updated_at).toBe(before.updated_at);
    expect(await auditUpdatedCount('epp_planificaciones', planifId)).toBe(auditBefore);
  });
});

describe('T-118 · no-conflicto con T-119', () => {
  it('5. reentrega del mismo (empleado,item) -> 1 activa; planif previa cumplida con fecha intacta; evento previo completed', async () => {
    const itemId = await seedItem(A, 6);

    const e1 = await seedEntrega(A, '2026-05-01T12:00:00Z', itemId);
    await genEpp(e1);
    const planif1 = await planifByEntrega(e1);
    const fecha1Antes = planif1.fecha_proxima_entrega;
    const event1Id = planif1.calendar_event_id!;

    // Reentrega: la RPC cierra la previa (cumplida) y completa su evento -> dispara el trigger T-118.
    const e2 = await seedEntrega(A, '2026-06-01T12:00:00Z', itemId);
    await genEpp(e2);

    // Sigue habiendo exactamente 1 activa (la de e2).
    expect(await activasCount(A, itemId)).toBe(1);
    const activa = await planifByEntrega(e2);
    expect(activa.estado).toBe('activa');

    // planif1 quedo cumplida y su fecha NO fue reescrita por el trigger (guard = no-op).
    const planif1After = await planifById(planif1.id);
    expect(planif1After.estado).toBe('cumplida');
    expect(new Date(planif1After.fecha_proxima_entrega).getTime()).toBe(
      new Date(fecha1Antes).getTime(),
    );

    // El evento previo quedo completed.
    const ev1 = await admin.from('calendar_events').select('status').eq('id', event1Id).single();
    expect(ev1.data?.status).toBe('completed');
  });
});

describe('T-118 · idempotencia y guard', () => {
  it('6. re-aplicar la misma fecha = no-op (WHEN clause; sin audit extra)', async () => {
    const { planifId, eventId } = await seedEppPlanif(A);

    await patchEvent(eventId, { fecha_vencimiento: '2027-05-01' });
    const planifMid = await planifById(planifId);
    expect(new Date(planifMid.fecha_proxima_entrega).toISOString()).toBe(noonUtcIso('2027-05-01'));
    const auditMid = await auditUpdatedCount('epp_planificaciones', planifId);

    // Mismo valor -> WHEN false -> el trigger no dispara -> dominio intacto.
    await patchEvent(eventId, { fecha_vencimiento: '2027-05-01' });
    const after = await planifById(planifId);
    expect(after.updated_at).toBe(planifMid.updated_at);
    expect(await auditUpdatedCount('epp_planificaciones', planifId)).toBe(auditMid);
  });

  it('8. editar fecha de un evento cuya planif ya esta cumplida = no-op (guard estados finales)', async () => {
    const { planifId, eventId } = await seedEppPlanif(A);
    // Forzar la planif a un estado final (simula cierre previo).
    await admin.from('epp_planificaciones').update({ estado: 'cumplida' }).eq('id', planifId);
    const before = await planifById(planifId);

    await patchEvent(eventId, { fecha_vencimiento: '2099-01-01' });

    const after = await planifById(planifId);
    expect(after.estado).toBe('cumplida');
    expect(new Date(after.fecha_proxima_entrega).getTime()).toBe(
      new Date(before.fecha_proxima_entrega).getTime(),
    );
  });
});

describe('T-118 · cross-tenant', () => {
  it('7. editar el evento de A no toca la planif de B', async () => {
    const a = await seedEppPlanif(A);
    const b = await seedEppPlanif(B);
    const bFechaAntes = (await planifById(b.planifId)).fecha_proxima_entrega;

    await patchEvent(a.eventId, { fecha_vencimiento: '2027-07-07' });

    // A cambia, B intacto.
    expect(new Date((await planifById(a.planifId)).fecha_proxima_entrega).toISOString()).toBe(
      noonUtcIso('2027-07-07'),
    );
    expect(new Date((await planifById(b.planifId)).fecha_proxima_entrega).getTime()).toBe(
      new Date(bFechaAntes).getTime(),
    );
  });
});

describe('T-118 · CAPA: accion_correctiva -> acciones_correctivas', () => {
  it('9. editar fecha del evento -> fecha_compromiso = nueva fecha (date->date)', async () => {
    const { accionId, eventId } = await seedCapa('2026-12-01');

    await patchEvent(eventId, { fecha_vencimiento: '2027-04-20' });

    expect((await accionById(accionId)).fecha_compromiso).toBe('2027-04-20');
  });

  it('10. completar el evento -> estado=cerrada + cerrada_at seteado', async () => {
    const { accionId, eventId } = await seedCapa('2026-12-15');

    await patchEvent(eventId, { status: 'completed', completed_at: new Date().toISOString() });

    const accion = await accionById(accionId);
    expect(accion.estado).toBe('cerrada');
    expect(accion.cerrada_at).not.toBeNull();
  });

  it('11. cancelar el evento -> estado=anulada', async () => {
    const { accionId, eventId } = await seedCapa('2026-12-20');

    await patchEvent(eventId, { status: 'cancelled' });

    expect((await accionById(accionId)).estado).toBe('anulada');
  });
});
