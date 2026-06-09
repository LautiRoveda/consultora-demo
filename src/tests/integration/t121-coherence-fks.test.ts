/**
 * T-121 (A) · Integration: las FK COMPUESTAS garantizan coherencia de consultora_id.
 *
 * Cada FK compuesta ((<fk>, consultora_id) -> parent(id, consultora_id)) rechaza
 * estructuralmente un hijo cuyo consultora_id != el del parent, con 23503
 * (foreign_key_violation). Cobertura representativa:
 *  - cascade: calendar_event_reminders -> calendar_events.
 *  - restrict: empleados -> clientes.
 *  - dual-parent (junction): empleados_puestos -> empleados + puestos (mismatch en
 *    CADA parent por separado -> 23503).
 *  - control positivo: el insert coherente (consultora_id = parent) pasa.
 *
 * service-role admin: testeamos el FK a nivel DB, NO la RLS (que también lo
 * bloquearía). runId namespacing + cleanup en orden FK inverso. Mismo harness que
 * epp-schema.test.ts.
 *
 * Correr local (Supabase efímero, requiere Docker):
 *   pnpm test:integration src/tests/integration/t121-coherence-fks.test.ts
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

let cAId: string;
let cBId: string;
let clienteAId: string;
let empleadoAId: string;
let puestoAId: string;
let empleadoBId: string;
let puestoBId: string;
let eventAId: string;

async function insertConsultora(slug: string): Promise<string> {
  const { data, error } = await admin
    .from('consultoras')
    .insert({ name: `T121 ${slug}`, slug })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insert consultora ${slug}: ${JSON.stringify(error)}`);
  return data.id;
}

beforeAll(async () => {
  // Setup secuencial (Promise.all sobre admin tiene flakiness en sa-east-1, lesson T-047).
  cAId = await insertConsultora(`coh-a-${runId}`);
  cBId = await insertConsultora(`coh-b-${runId}`);

  const cli = await admin
    .from('clientes')
    .insert({ consultora_id: cAId, razon_social: `T121 cliente ${runId}`, cuit: '30-12345678-9' })
    .select('id')
    .single();
  if (cli.error || !cli.data) throw new Error(`insert clienteA: ${JSON.stringify(cli.error)}`);
  clienteAId = cli.data.id;

  const cliB = await admin
    .from('clientes')
    .insert({ consultora_id: cBId, razon_social: `T121 cliente B ${runId}`, cuit: '30-98765432-1' })
    .select('id')
    .single();
  if (cliB.error || !cliB.data) throw new Error(`insert clienteB: ${JSON.stringify(cliB.error)}`);
  const clienteBId = cliB.data.id;

  const empA = await admin
    .from('empleados')
    .insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'Ana',
      apellido: 'Lopez',
      dni: '30100001',
    })
    .select('id')
    .single();
  if (empA.error || !empA.data) throw new Error(`insert empleadoA: ${JSON.stringify(empA.error)}`);
  empleadoAId = empA.data.id;

  const empB = await admin
    .from('empleados')
    .insert({
      consultora_id: cBId,
      cliente_id: clienteBId,
      nombre: 'Beto',
      apellido: 'Diaz',
      dni: '30100002',
    })
    .select('id')
    .single();
  if (empB.error || !empB.data) throw new Error(`insert empleadoB: ${JSON.stringify(empB.error)}`);
  empleadoBId = empB.data.id;

  const pstA = await admin
    .from('puestos')
    .insert({ consultora_id: cAId, nombre: `Soldador ${runId}` })
    .select('id')
    .single();
  if (pstA.error || !pstA.data) throw new Error(`insert puestoA: ${JSON.stringify(pstA.error)}`);
  puestoAId = pstA.data.id;

  const pstB = await admin
    .from('puestos')
    .insert({ consultora_id: cBId, nombre: `Gruista ${runId}` })
    .select('id')
    .single();
  if (pstB.error || !pstB.data) throw new Error(`insert puestoB: ${JSON.stringify(pstB.error)}`);
  puestoBId = pstB.data.id;

  const ev = await admin
    .from('calendar_events')
    .insert({
      consultora_id: cAId,
      tipo: 'custom',
      titulo: `T121 evento ${runId}`,
      fecha_vencimiento: '2026-12-01',
      reminder_offsets_days: [7, 0],
    })
    .select('id')
    .single();
  if (ev.error || !ev.data) throw new Error(`insert eventA: ${JSON.stringify(ev.error)}`);
  eventAId = ev.data.id;
});

afterAll(async () => {
  // Orden FK inverso. La consultora NO se borra (audit_log -> consultoras RESTRICT +
  // inmutable hace el hard-delete imposible; mismo leak best-effort que los demás
  // tests del módulo, lo limpia el db reset entre runs de CI).
  await admin
    .from('empleados_puestos')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('calendar_event_reminders')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('calendar_events')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('empleados')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('puestos')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('clientes')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('consultoras')
    .delete()
    .in('id', [cAId, cBId])
    .then(() => {});
});

describe('T-121 · FK compuesta calendar_event_reminders -> calendar_events (cascade)', () => {
  it('reminder con consultora_id = event.consultora_id pasa (control positivo)', async () => {
    const { error } = await admin.from('calendar_event_reminders').insert({
      event_id: eventAId,
      consultora_id: cAId,
      offset_days: 7,
      scheduled_at: new Date('2026-11-24T12:00:00Z').toISOString(),
      status: 'pending',
    });
    expect(error).toBeNull();
  });

  it('reminder con consultora_id de OTRO tenant -> 23503 (FK violation)', async () => {
    const { error } = await admin.from('calendar_event_reminders').insert({
      event_id: eventAId,
      consultora_id: cBId, // el evento es de cA -> la FK compuesta rechaza
      offset_days: 3,
      scheduled_at: new Date('2026-11-28T12:00:00Z').toISOString(),
      status: 'pending',
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23503');
  });
});

describe('T-121 · FK compuesta empleados -> clientes (restrict)', () => {
  it('empleado con consultora_id = cliente.consultora_id pasa (control positivo)', async () => {
    const { error } = await admin.from('empleados').insert({
      consultora_id: cAId,
      cliente_id: clienteAId,
      nombre: 'Carlos',
      apellido: 'Ruiz',
      dni: '30100003',
    });
    expect(error).toBeNull();
  });

  it('empleado con consultora_id de OTRO tenant (cliente es de A) -> 23503', async () => {
    const { error } = await admin.from('empleados').insert({
      consultora_id: cBId, // el cliente es de cA -> la FK compuesta rechaza
      cliente_id: clienteAId,
      nombre: 'Hacker',
      apellido: 'CrossTenant',
      dni: '30100004',
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23503');
  });
});

describe('T-121 · FK compuesta dual-parent empleados_puestos -> empleados + puestos', () => {
  it('asignación coherente (empleadoA, puestoA, consultora A) pasa (control positivo)', async () => {
    const { error } = await admin.from('empleados_puestos').insert({
      empleado_id: empleadoAId,
      puesto_id: puestoAId,
      consultora_id: cAId,
    });
    expect(error).toBeNull();
  });

  it('mismatch en puesto_id (puesto de B, consultora A) -> 23503', async () => {
    const { error } = await admin.from('empleados_puestos').insert({
      empleado_id: empleadoAId, // de A -> FK empleados OK
      puesto_id: puestoBId, // de B -> FK puestos (puesto_id, A) no existe -> rechaza
      consultora_id: cAId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23503');
  });

  it('mismatch en empleado_id (empleado de B, consultora A) -> 23503', async () => {
    const { error } = await admin.from('empleados_puestos').insert({
      empleado_id: empleadoBId, // de B -> FK empleados (empleado_id, A) no existe -> rechaza
      puesto_id: puestoAId, // de A -> FK puestos OK
      consultora_id: cAId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23503');
  });
});
