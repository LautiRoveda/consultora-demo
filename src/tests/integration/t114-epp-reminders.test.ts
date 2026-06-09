/**
 * T-114 · Integration: gen_epp_planificaciones_y_calendar_for crea reminders.
 *
 * Regression: la RPC creaba el calendar_event (offsets [14,3,0]) pero NUNCA
 * filas en calendar_event_reminders -> el cron process_pending_reminders no
 * tenia nada que disparar -> vencimientos EPP mudos en prod (T-114). Este test
 * ancla que la RPC ahora puebla los 3 reminders (12:00 UTC, status pending) para
 * un vencimiento futuro, y que omite los offsets que caen en el pasado.
 *
 * Demo red->green: contra la RPC VIEJA da 0 reminders (rojo); con el fix da 3.
 *
 * Correr local (Supabase efimero):
 *   pnpm test:integration src/tests/integration/t114-epp-reminders.test.ts
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
const slug = `t114-${runId}`;
const emailOwner = `t114-own-${runId}@example.com`;

let consultoraId: string;
let ownerId: string;
let clienteId: string;
let empleadoId: string;
let categoriaId: string;

// SCHEDULED_AT_SEND_HOUR_UTC = 12 (09:00 ART). Reimplementacion local de
// computeScheduledAtUtc para no importar el modulo del calendario (evita tirar
// de Next/server-only en un test de DB pura).
function expectedScheduledIso(fechaVencimientoIso: string, offsetDays: number): string {
  const [y, m, d] = fechaVencimientoIso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - offsetDays, 12, 0, 0)).toISOString();
}

// Crea item (no descartable) + entrega + entrega_item y devuelve el id de entrega.
async function seedEntrega(opts: {
  fechaEntregaIso: string;
  vidaUtilMeses: number;
  label: string;
}): Promise<string> {
  const item = await admin
    .from('epp_items')
    .insert({
      consultora_id: consultoraId,
      categoria_id: categoriaId,
      nombre: `T114 ${opts.label} ${runId}`,
      vida_util_meses: opts.vidaUtilMeses,
      es_descartable: false,
      requiere_numero_serie: false,
    })
    .select('id')
    .single();
  if (item.error || !item.data) throw new Error(`insert item: ${JSON.stringify(item.error)}`);

  const entrega = await admin
    .from('epp_entregas')
    .insert({
      consultora_id: consultoraId,
      empleado_id: empleadoId,
      cliente_id: clienteId,
      fecha_entrega: opts.fechaEntregaIso,
      created_by: ownerId,
    })
    .select('id')
    .single();
  if (entrega.error || !entrega.data)
    throw new Error(`insert entrega: ${JSON.stringify(entrega.error)}`);

  const ei = await admin.from('epp_entrega_items').insert({
    entrega_id: entrega.data.id,
    item_id: item.data.id,
    consultora_id: consultoraId,
    cantidad: 1,
    motivo_entrega: 'inicial',
  });
  if (ei.error) throw new Error(`insert entrega_item: ${JSON.stringify(ei.error)}`);

  return entrega.data.id;
}

beforeAll(async () => {
  const c = await admin.from('consultoras').insert({ name: 'T114', slug }).select('id').single();
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
      razon_social: `T114 cli ${runId}`,
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
      nombre: 'T114',
      apellido: 'EPP',
      dni: '30123456',
    })
    .select('id')
    .single();
  if (emp.error || !emp.data) throw new Error(`insert empleado: ${JSON.stringify(emp.error)}`);
  empleadoId = emp.data.id;

  const cat = await admin
    .from('epp_categorias')
    .insert({ consultora_id: consultoraId, nombre: `T114 cat ${runId}` })
    .select('id')
    .single();
  if (cat.error || !cat.data) throw new Error(`insert categoria: ${JSON.stringify(cat.error)}`);
  categoriaId = cat.data.id;
});

afterAll(async () => {
  // Convencion t105: solo borramos el auth user (no cascadea por consultora). El
  // resto lo limpia el reset efimero del runner; los registros del dominio quedan
  // namespaced por runId y NO se borran via service_role a proposito: epp_entregas
  // son evidencia legal inmutable y `delete consultoras` es no-op silencioso
  // (audit_log ON DELETE RESTRICT + append-only).
  await admin.auth.admin.deleteUser(ownerId).catch(() => {});
});

describe('T-114 gen_epp_planificaciones_y_calendar_for · reminders', () => {
  it('vencimiento futuro -> crea 3 reminders (offsets 14/3/0, pending, 12:00 UTC)', async () => {
    // fecha_entrega 2026-05-01 + 6m -> vencimiento 2026-11-01 (los 3 offsets futuros).
    const entregaId = await seedEntrega({
      fechaEntregaIso: '2026-05-01T12:00:00Z',
      vidaUtilMeses: 6,
      label: 'futuro',
    });

    const rpc = await admin.rpc('gen_epp_planificaciones_y_calendar_for', {
      p_entrega_id: entregaId,
    });
    expect(rpc.error).toBeNull();

    const ev = await admin
      .from('calendar_events')
      .select('id, fecha_vencimiento')
      .eq('consultora_id', consultoraId)
      .eq('tipo', 'epp_entrega')
      .contains('metadata', { epp_entrega_id: entregaId })
      .single();
    expect(ev.error).toBeNull();
    expect(ev.data).not.toBeNull();
    const vencimiento = ev.data!.fecha_vencimiento; // YYYY-MM-DD

    const { data: reminders, error } = await admin
      .from('calendar_event_reminders')
      .select('offset_days, scheduled_at, status')
      .eq('event_id', ev.data!.id)
      .order('offset_days', { ascending: false });
    expect(error).toBeNull();
    expect(reminders).toHaveLength(3); // <- ROJO contra la RPC vieja (0); VERDE con el fix.
    expect(reminders!.map((r) => r.offset_days)).toEqual([14, 3, 0]);
    for (const r of reminders!) {
      expect(r.status).toBe('pending');
      expect(new Date(r.scheduled_at).toISOString()).toBe(
        expectedScheduledIso(vencimiento, r.offset_days),
      );
    }
  });

  it('vencimiento cercano -> omite los offsets que caen en el pasado', async () => {
    // Seed para que el vencimiento quede ~5 dias en el futuro: offset 0 (+5d) y
    // offset 3 (+2d) son futuros -> se crean; offset 14 (-9d) es pasado -> se omite.
    // fecha_entrega = (hoy + 5d) - 6 meses, normalizada a mediodia UTC (igual que
    // el test 1) para sacar ambiguedad de truncado ::date cerca de medianoche. Las
    // expectativas se DERIVAN del vencimiento leido de la DB (no de recomputar el
    // mes en JS) -> robusto ante el clamping de '+ interval 6 months' de Postgres.
    const fechaEntrega = new Date();
    fechaEntrega.setUTCDate(fechaEntrega.getUTCDate() + 5);
    fechaEntrega.setUTCMonth(fechaEntrega.getUTCMonth() - 6);
    fechaEntrega.setUTCHours(12, 0, 0, 0);

    const entregaId = await seedEntrega({
      fechaEntregaIso: fechaEntrega.toISOString(),
      vidaUtilMeses: 6,
      label: 'cercano',
    });

    const rpc = await admin.rpc('gen_epp_planificaciones_y_calendar_for', {
      p_entrega_id: entregaId,
    });
    expect(rpc.error).toBeNull();

    const ev = await admin
      .from('calendar_events')
      .select('id, fecha_vencimiento')
      .eq('consultora_id', consultoraId)
      .eq('tipo', 'epp_entrega')
      .contains('metadata', { epp_entrega_id: entregaId })
      .single();
    expect(ev.error).toBeNull();
    const vencimiento = ev.data!.fecha_vencimiento;

    // Set esperado: los offsets cuyo scheduled_at (12:00 UTC) sigue siendo futuro.
    const now = Date.now();
    const expectedOffsets = [14, 3, 0]
      .filter((o) => new Date(expectedScheduledIso(vencimiento, o)).getTime() >= now)
      .sort((a, b) => b - a);
    // Sanity: este caso debe ejercer la rama "omitir pasado" (1 o 2 presentes, no 3).
    expect(expectedOffsets.length).toBeGreaterThanOrEqual(1);
    expect(expectedOffsets.length).toBeLessThan(3);

    const { data: reminders } = await admin
      .from('calendar_event_reminders')
      .select('offset_days')
      .eq('event_id', ev.data!.id)
      .order('offset_days', { ascending: false });
    expect((reminders ?? []).map((r) => r.offset_days)).toEqual(expectedOffsets);
  });
});
