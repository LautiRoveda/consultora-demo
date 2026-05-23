/**
 * T-100 · Tests schema EPP: RLS + post-entrega function + constraint trigger.
 *
 * Cobertura (6 tests):
 * 1. RLS cross-tenant: member cA NO ve epp_items de cB.
 * 2. gen_epp_planificaciones_y_calendar_for con item NO descartable →
 *    crea epp_planificaciones + calendar_events (tipo=epp_entrega, [14,3,0]).
 * 3. Item es_descartable=true → NO genera planificacion.
 * 4. epp_entrega_items con requiere_numero_serie=true SIN numero_serie →
 *    falla con errcode 23514 (check_violation).
 * 5. empleados_puestos PK violation: insertar mismo (empleado_id, puesto_id) 2x.
 * 6. vida_util_meses_override=12 → frecuencia_meses=12 en planificacion generada.
 *
 * Correr local:
 *   set -a && source .env.local && set +a && \
 *     pnpm test:integration src/tests/integration/epp-schema.test.ts
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
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slugA = `t100-epp-a-${runId}`;
const slugB = `t100-epp-b-${runId}`;
const emailMemberA = `t100-epp-member-a-${runId}@example.com`;
const emailOwnerB = `t100-epp-owner-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let memberAId: string;
let ownerBId: string;
let clienteAId: string;
let empleadoAId: string;
let categoriaAId: string;
let categoriaBId: string;
let itemRegistrableAId: string;
let itemDescartableAId: string;
let itemRequiereSerieAId: string;
let itemRegistrableBId: string;
let puestoAId: string;
let clientMemberA: SupabaseClient<Database>;

beforeAll(async () => {
  // Setup secuencial — Promise.all sobre admin tiene flakiness en sa-east-1
  // (UND_ERR ConnectTimeoutError, lesson T-047).
  const resA = await admin
    .from('consultoras')
    .insert({ name: 'T100 EPP cA', slug: slugA })
    .select('id')
    .single();
  if (resA.error || !resA.data) throw new Error(`insert cA: ${JSON.stringify(resA.error)}`);
  cAId = resA.data.id;

  const resB = await admin
    .from('consultoras')
    .insert({ name: 'T100 EPP cB', slug: slugB })
    .select('id')
    .single();
  if (resB.error || !resB.data) throw new Error(`insert cB: ${JSON.stringify(resB.error)}`);
  cBId = resB.data.id;

  const uMA = await admin.auth.admin.createUser({
    email: emailMemberA,
    password,
    email_confirm: true,
  });
  if (uMA.error || !uMA.data.user)
    throw new Error(`createUser memberA: ${JSON.stringify(uMA.error)}`);
  memberAId = uMA.data.user.id;

  const uOB = await admin.auth.admin.createUser({
    email: emailOwnerB,
    password,
    email_confirm: true,
  });
  if (uOB.error || !uOB.data.user)
    throw new Error(`createUser ownerB: ${JSON.stringify(uOB.error)}`);
  ownerBId = uOB.data.user.id;

  await admin.from('consultora_members').insert([
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await Promise.all([
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  const sbMA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await sbMA.auth.signInWithPassword({ email: emailMemberA, password });
  clientMemberA = sbMA;

  // Fixtures cA: cliente + empleado + categoria + 3 items (registrable, descartable, requiere serie) + puesto.
  const cli = await admin
    .from('clientes')
    .insert({
      consultora_id: cAId,
      razon_social: `T100 cliente ${runId}`,
      cuit: '30-12345678-9',
    })
    .select('id')
    .single();
  if (cli.error || !cli.data) throw new Error(`insert cliente: ${JSON.stringify(cli.error)}`);
  clienteAId = cli.data.id;

  const emp = await admin
    .from('empleados')
    .insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'Juan',
      apellido: 'Perez',
      dni: '30123456',
    })
    .select('id')
    .single();
  if (emp.error || !emp.data) throw new Error(`insert empleado: ${JSON.stringify(emp.error)}`);
  empleadoAId = emp.data.id;

  const catA = await admin
    .from('epp_categorias')
    .insert({ consultora_id: cAId, nombre: `Proteccion cabeza ${runId}` })
    .select('id')
    .single();
  if (catA.error || !catA.data) throw new Error(`insert categoriaA: ${JSON.stringify(catA.error)}`);
  categoriaAId = catA.data.id;

  const catB = await admin
    .from('epp_categorias')
    .insert({ consultora_id: cBId, nombre: `Proteccion cabeza ${runId}` })
    .select('id')
    .single();
  if (catB.error || !catB.data) throw new Error(`insert categoriaB: ${JSON.stringify(catB.error)}`);
  categoriaBId = catB.data.id;

  const itemReg = await admin
    .from('epp_items')
    .insert({
      consultora_id: cAId,
      categoria_id: categoriaAId,
      nombre: `Casco clase A ${runId}`,
      vida_util_meses: 6,
      es_descartable: false,
      requiere_numero_serie: false,
    })
    .select('id')
    .single();
  if (itemReg.error || !itemReg.data)
    throw new Error(`insert item registrable: ${JSON.stringify(itemReg.error)}`);
  itemRegistrableAId = itemReg.data.id;

  const itemDesc = await admin
    .from('epp_items')
    .insert({
      consultora_id: cAId,
      categoria_id: categoriaAId,
      nombre: `Guante nitrilo ${runId}`,
      vida_util_meses: 6,
      es_descartable: true,
      requiere_numero_serie: false,
    })
    .select('id')
    .single();
  if (itemDesc.error || !itemDesc.data)
    throw new Error(`insert item descartable: ${JSON.stringify(itemDesc.error)}`);
  itemDescartableAId = itemDesc.data.id;

  const itemSerie = await admin
    .from('epp_items')
    .insert({
      consultora_id: cAId,
      categoria_id: categoriaAId,
      nombre: `Arnes cuerpo entero ${runId}`,
      vida_util_meses: 12,
      es_descartable: false,
      requiere_numero_serie: true,
    })
    .select('id')
    .single();
  if (itemSerie.error || !itemSerie.data)
    throw new Error(`insert item serie: ${JSON.stringify(itemSerie.error)}`);
  itemRequiereSerieAId = itemSerie.data.id;

  const itemBReg = await admin
    .from('epp_items')
    .insert({
      consultora_id: cBId,
      categoria_id: categoriaBId,
      nombre: `Casco clase A ${runId} cB`,
      vida_util_meses: 6,
    })
    .select('id')
    .single();
  if (itemBReg.error || !itemBReg.data)
    throw new Error(`insert item cB: ${JSON.stringify(itemBReg.error)}`);
  itemRegistrableBId = itemBReg.data.id;

  const pst = await admin
    .from('puestos')
    .insert({
      consultora_id: cAId,
      nombre: `Soldador ${runId}`,
      riesgos_asociados: ['quimico', 'ocular'],
    })
    .select('id')
    .single();
  if (pst.error || !pst.data) throw new Error(`insert puesto: ${JSON.stringify(pst.error)}`);
  puestoAId = pst.data.id;
});

afterAll(async () => {
  // Orden FK estricto inverso (RESTRICT enforcement):
  // planificaciones -> entregas (cascade items) -> calendar_events -> empleados_puestos
  // -> epp_items -> epp_categorias -> puestos -> empleados -> clientes
  // -> audit_log (FK consultoras RESTRICT) -> members -> consultoras -> users.
  await admin
    .from('epp_planificaciones')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('epp_entregas')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('calendar_events')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('empleados_puestos')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('epp_items')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('epp_categorias')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('puestos')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('empleados')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('clientes')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('audit_log')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('consultora_members')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('consultoras')
    .delete()
    .in('id', [cAId, cBId])
    .then(() => {});
  await Promise.all([
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
  ]);
});

describe('epp · RLS cross-tenant', () => {
  it('memberA NO ve epp_items de cB (cross-tenant)', async () => {
    const { data, error } = await clientMemberA
      .from('epp_items')
      .select('id')
      .eq('id', itemRegistrableBId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('memberA SI ve epp_items de cA (control positivo)', async () => {
    const { data, error } = await clientMemberA
      .from('epp_items')
      .select('id, nombre')
      .eq('id', itemRegistrableAId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(itemRegistrableAId);
  });
});

describe('epp · gen_epp_planificaciones_y_calendar_for (item NO descartable)', () => {
  it('genera 1 epp_planificaciones + 1 calendar_events (tipo=epp_entrega, [14,3,0])', async () => {
    const fechaEntrega = new Date('2026-06-01T10:00:00Z');
    const { data: en, error: enErr } = await admin
      .from('epp_entregas')
      .insert({
        consultora_id: cAId,
        empleado_id: empleadoAId,
        cliente_id: clienteAId,
        fecha_entrega: fechaEntrega.toISOString(),
      })
      .select('id')
      .single();
    if (enErr || !en) throw new Error(`insert entrega: ${JSON.stringify(enErr)}`);

    const { error: itErr } = await admin.from('epp_entrega_items').insert({
      entrega_id: en.id,
      item_id: itemRegistrableAId,
      consultora_id: cAId,
      cantidad: 1,
      motivo_entrega: 'inicial',
    });
    expect(itErr).toBeNull();

    const { error: rpcErr } = await admin.rpc('gen_epp_planificaciones_y_calendar_for', {
      p_entrega_id: en.id,
    });
    expect(rpcErr).toBeNull();

    const { data: planifs } = await admin
      .from('epp_planificaciones')
      .select('id, item_id, frecuencia_meses, fecha_proxima_entrega, estado, calendar_event_id')
      .eq('generado_de_entrega_id', en.id);

    expect(planifs).toHaveLength(1);
    const p = planifs![0]!;
    expect(p.item_id).toBe(itemRegistrableAId);
    expect(p.frecuencia_meses).toBe(6);
    expect(p.estado).toBe('activa');
    expect(p.calendar_event_id).not.toBeNull();
    // fecha_entrega + 6 months = 2026-12-01
    expect(new Date(p.fecha_proxima_entrega).toISOString().slice(0, 10)).toBe('2026-12-01');

    const { data: ev } = await admin
      .from('calendar_events')
      .select('id, tipo, reminder_offsets_days, status, fecha_vencimiento')
      .eq('id', p.calendar_event_id!)
      .single();
    expect(ev?.tipo).toBe('epp_entrega');
    expect(ev?.reminder_offsets_days).toEqual([14, 3, 0]);
    expect(ev?.status).toBe('pending');
    expect(ev?.fecha_vencimiento).toBe('2026-12-01');
  });
});

describe('epp · item descartable NO genera planificacion', () => {
  it('entrega con SOLO item descartable + invocar funcion → 0 planificaciones', async () => {
    const { data: en, error: enErr } = await admin
      .from('epp_entregas')
      .insert({
        consultora_id: cAId,
        empleado_id: empleadoAId,
        cliente_id: clienteAId,
        fecha_entrega: new Date('2026-06-02T10:00:00Z').toISOString(),
      })
      .select('id')
      .single();
    if (enErr || !en) throw new Error(`insert entrega descartable: ${JSON.stringify(enErr)}`);

    const { error: itErr } = await admin.from('epp_entrega_items').insert({
      entrega_id: en.id,
      item_id: itemDescartableAId,
      consultora_id: cAId,
      cantidad: 10,
      motivo_entrega: 'inicial',
    });
    expect(itErr).toBeNull();

    const { error: rpcErr } = await admin.rpc('gen_epp_planificaciones_y_calendar_for', {
      p_entrega_id: en.id,
    });
    expect(rpcErr).toBeNull();

    const { data: planifs } = await admin
      .from('epp_planificaciones')
      .select('id')
      .eq('generado_de_entrega_id', en.id);
    expect(planifs).toHaveLength(0);
  });
});

describe('epp · BEFORE INSERT trigger valida numero_serie', () => {
  it('item requiere_numero_serie=true SIN numero_serie → errcode 23514', async () => {
    const { data: en, error: enErr } = await admin
      .from('epp_entregas')
      .insert({
        consultora_id: cAId,
        empleado_id: empleadoAId,
        cliente_id: clienteAId,
      })
      .select('id')
      .single();
    if (enErr || !en) throw new Error(`insert entrega serie: ${JSON.stringify(enErr)}`);

    const { error } = await admin.from('epp_entrega_items').insert({
      entrega_id: en.id,
      item_id: itemRequiereSerieAId,
      consultora_id: cAId,
      cantidad: 1,
      motivo_entrega: 'inicial',
      // numero_serie omitido a proposito
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
    expect(error?.message.toLowerCase()).toMatch(/requiere numero_serie/);

    // Verificar que CON numero_serie SI funciona.
    const { error: okErr } = await admin.from('epp_entrega_items').insert({
      entrega_id: en.id,
      item_id: itemRequiereSerieAId,
      consultora_id: cAId,
      cantidad: 1,
      motivo_entrega: 'inicial',
      numero_serie: `SN-T100-${runId}`,
    });
    expect(okErr).toBeNull();
  });
});

describe('epp · empleados_puestos M:N PK constraint', () => {
  it('insertar mismo (empleado_id, puesto_id) 2x → PK violation', async () => {
    const { error: e1 } = await admin.from('empleados_puestos').insert({
      empleado_id: empleadoAId,
      puesto_id: puestoAId,
      consultora_id: cAId,
    });
    expect(e1).toBeNull();

    const { error: e2 } = await admin.from('empleados_puestos').insert({
      empleado_id: empleadoAId,
      puesto_id: puestoAId,
      consultora_id: cAId,
    });
    expect(e2).not.toBeNull();
    expect(e2?.code).toBe('23505');
  });
});

describe('epp · vida_util_meses_override sobrescribe default del item', () => {
  it('override=12 sobre item vida_util=6 → planificacion frecuencia_meses=12 + fecha +12m', async () => {
    const fechaEntrega = new Date('2026-06-03T10:00:00Z');
    const { data: en, error: enErr } = await admin
      .from('epp_entregas')
      .insert({
        consultora_id: cAId,
        empleado_id: empleadoAId,
        cliente_id: clienteAId,
        fecha_entrega: fechaEntrega.toISOString(),
      })
      .select('id')
      .single();
    if (enErr || !en) throw new Error(`insert entrega override: ${JSON.stringify(enErr)}`);

    const { error: itErr } = await admin.from('epp_entrega_items').insert({
      entrega_id: en.id,
      item_id: itemRegistrableAId,
      consultora_id: cAId,
      cantidad: 1,
      motivo_entrega: 'inicial',
      vida_util_meses_override: 12,
    });
    expect(itErr).toBeNull();

    const { error: rpcErr } = await admin.rpc('gen_epp_planificaciones_y_calendar_for', {
      p_entrega_id: en.id,
    });
    expect(rpcErr).toBeNull();

    const { data: planifs } = await admin
      .from('epp_planificaciones')
      .select('frecuencia_meses, fecha_proxima_entrega')
      .eq('generado_de_entrega_id', en.id);
    expect(planifs).toHaveLength(1);
    expect(planifs![0]!.frecuencia_meses).toBe(12);
    // fecha_entrega 2026-06-03 + 12 months = 2027-06-03
    expect(new Date(planifs![0]!.fecha_proxima_entrega).toISOString().slice(0, 10)).toBe(
      '2027-06-03',
    );
  });
});
