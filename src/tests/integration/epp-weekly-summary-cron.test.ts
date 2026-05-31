/**
 * T-109 · Integration tests del cron de resumen semanal EPP.
 *
 * Cobertura (gate Pieza A):
 *  1-2. POST /api/cron/weekly-summary sin secret / secret invalido -> 401.
 *  3.   armarResumenEpp con SERVICE ROLE (bypassa RLS): el resumen de A NO
 *       incluye NADA de B (cross-tenant explicito, ajuste 3).
 *  4.   sendEppWeeklySummary end-to-end: log row + Resend invocado + html con
 *       datos de A.
 *  5.   Idempotencia: 2x mismo (consultora, periodo) -> 1 sola row + 1 sola
 *       llamada Resend (segunda devuelve already_sent).
 *  6.   Predicado "no email vacio": consultora sin actividad -> no accionable.
 *
 * Mocks: server-only, resend. Corre con service role (no JWT de member) — el
 * cron real usa service role, asi que el test reproduce ese contexto.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration -- epp-weekly-summary-cron`
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockEmailsSend = vi.fn();
vi.mock('@/shared/notifications/resend', () => ({
  getResendClient: () => ({ emails: { send: mockEmailsSend } }),
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Tests requieren env Supabase.');

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DAY = 86_400_000;
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';

type Tenant = {
  consultoraId: string;
  ownerId: string;
  empleadoApellido: string;
  itemNombre: string;
};

let A: Tenant;
let B: Tenant;
let vaciaId: string; // consultora sin actividad (predicado)

async function seedTenant(
  tag: string,
  empleadoApellido: string,
  itemNombre: string,
): Promise<Tenant> {
  const consultoraId = (
    await admin
      .from('consultoras')
      .insert({ name: `T109WS ${tag}`, slug: `t109ws-${tag}-${runId}` })
      .select('id')
      .single()
  ).data!.id;

  const ownerId = (
    await admin.auth.admin.createUser({
      email: `t109ws-${tag}-${runId}@example.com`,
      password,
      email_confirm: true,
    })
  ).data.user!.id;
  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: consultoraId, role: 'owner' });

  const clienteId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        razon_social: `Cliente ${tag} ${runId}`,
        cuit: `30-${Date.now().toString().slice(-8).padStart(8, '0')}-${tag === 'a' ? '1' : '2'}`,
        created_by: ownerId,
      })
      .select('id')
      .single()
  ).data!.id;

  const empleadoId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: consultoraId,
        cliente_id: clienteId,
        nombre: 'Juan',
        apellido: empleadoApellido,
        dni: tag === 'a' ? '20111222' : '20333444',
        created_by: ownerId,
      })
      .select('id')
      .single()
  ).data!.id;

  const categoriaId = (
    await admin
      .from('epp_categorias')
      .insert({ consultora_id: consultoraId, nombre: `Cat ${tag} ${runId}`, created_by: ownerId })
      .select('id')
      .single()
  ).data!.id;

  const itemId = (
    await admin
      .from('epp_items')
      .insert({
        consultora_id: consultoraId,
        categoria_id: categoriaId,
        nombre: itemNombre,
        vida_util_meses: 12,
        es_descartable: false,
        requiere_numero_serie: false,
        created_by: ownerId,
      })
      .select('id')
      .single()
  ).data!.id;

  // Entrega firmada hace 1 dia (entra en la ventana de 7d).
  const entregaId = (
    await admin
      .from('epp_entregas')
      .insert({
        consultora_id: consultoraId,
        empleado_id: empleadoId,
        cliente_id: clienteId,
        fecha_entrega: new Date(Date.now() - DAY).toISOString(),
        firmado_at: new Date(Date.now() - DAY).toISOString(),
        firma_storage_path: `t109ws/${consultoraId}/e.png`,
        created_by: ownerId,
      })
      .select('id')
      .single()
  ).data!.id;

  await admin.from('epp_entrega_items').insert({
    entrega_id: entregaId,
    item_id: itemId,
    consultora_id: consultoraId,
    cantidad: 1,
    motivo_entrega: 'inicial',
  });

  // Planificacion activa venciendo en 3 dias (entra en la ventana futura de 7d).
  await admin.from('epp_planificaciones').insert({
    consultora_id: consultoraId,
    empleado_id: empleadoId,
    item_id: itemId,
    fecha_proxima_entrega: new Date(Date.now() + 3 * DAY).toISOString(),
    frecuencia_meses: 6,
    generado_de_entrega_id: entregaId,
    estado: 'activa',
  });

  return { consultoraId, ownerId, empleadoApellido, itemNombre };
}

beforeAll(async () => {
  A = await seedTenant('a', `AlphaA-${runId}`, `CascoA-${runId}`);
  B = await seedTenant('b', `BetaB-${runId}`, `BotinB-${runId}`);

  vaciaId = (
    await admin
      .from('consultoras')
      .insert({ name: `T109WS vacia`, slug: `t109ws-vacia-${runId}` })
      .select('id')
      .single()
  ).data!.id;
});

afterAll(async () => {
  const ids = [A?.consultoraId, B?.consultoraId, vaciaId].filter(Boolean);
  await admin.from('notification_digest_log').delete().in('consultora_id', ids);
  await admin.from('epp_planificaciones').delete().in('consultora_id', ids);
  await admin.from('epp_entrega_items').delete().in('consultora_id', ids);
  await admin.from('epp_entregas').delete().in('consultora_id', ids);
  await admin.from('epp_items').delete().in('consultora_id', ids);
  await admin.from('epp_categorias').delete().in('consultora_id', ids);
  await admin.from('empleados').delete().in('consultora_id', ids);
  await admin.from('clientes').delete().in('consultora_id', ids);
  await admin.from('audit_log').delete().in('consultora_id', ids);
  await admin.from('consultora_members').delete().in('consultora_id', ids);
  await admin.from('consultoras').delete().in('id', ids);
  await admin.auth.admin.deleteUser(A?.ownerId).catch(() => {});
  await admin.auth.admin.deleteUser(B?.ownerId).catch(() => {});
});

beforeEach(() => {
  mockEmailsSend.mockReset();
  mockEmailsSend.mockImplementation(() =>
    Promise.resolve({
      data: { id: `rsd_test_${Math.random().toString(36).slice(2, 8)}` },
      error: null,
    }),
  );
});

describe('POST /api/cron/weekly-summary · auth', () => {
  it('1. sin header X-Internal-Cron-Secret -> 401', async () => {
    const { POST } = await import('@/app/api/cron/weekly-summary/route');
    const req = new NextRequest('http://localhost/api/cron/weekly-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHORIZED');
  });

  it('2. header invalido -> 401', async () => {
    const { POST } = await import('@/app/api/cron/weekly-summary/route');
    const req = new NextRequest('http://localhost/api/cron/weekly-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Cron-Secret': 'wrong' },
      body: '{}',
    });
    expect((await POST(req)).status).toBe(401);
  });
});

describe('armarResumenEpp · cross-tenant con service role', () => {
  it('3. resumen de A no incluye NADA de B', async () => {
    const { armarResumenEpp } = await import('@/shared/notifications/digests/epp-weekly-data');
    const now = new Date();
    const desde = new Date(now.getTime() - 7 * DAY).toISOString();
    const hasta = new Date(now.getTime() + 7 * DAY).toISOString();

    const resumen = await armarResumenEpp(admin, A.consultoraId, desde, now.toISOString(), hasta);
    expect(resumen.entregas7d).toBeGreaterThanOrEqual(1);
    expect(resumen.vencimientos7d.length).toBeGreaterThanOrEqual(1);

    const blob = JSON.stringify(resumen.vencimientos7d);
    expect(blob).toContain(A.itemNombre);
    expect(blob).toContain(A.empleadoApellido);
    // Aislamiento: nada de B.
    expect(blob).not.toContain(B.itemNombre);
    expect(blob).not.toContain(B.empleadoApellido);
  });
});

describe('sendEppWeeklySummary · end-to-end + idempotencia', () => {
  it('4. happy path: log row + Resend send + html con datos de A', async () => {
    const { armarResumenEpp } = await import('@/shared/notifications/digests/epp-weekly-data');
    const { sendEppWeeklySummary } = await import('@/shared/notifications/digests/epp-weekly');
    const now = new Date();
    const desde = new Date(now.getTime() - 7 * DAY).toISOString();
    const hasta = new Date(now.getTime() + 7 * DAY).toISOString();
    const resumen = await armarResumenEpp(admin, A.consultoraId, desde, now.toISOString(), hasta);

    const r = await sendEppWeeklySummary(
      admin,
      { id: A.consultoraId, name: 'T109WS a' },
      resumen,
      '2026-W22',
    );
    expect(r.sent).toBe(true);
    if (!r.sent) return;
    expect(r.emailId).toMatch(/^rsd_test_/);
    expect(mockEmailsSend).toHaveBeenCalledOnce();
    expect(mockEmailsSend.mock.calls[0]![0].html).toContain(A.itemNombre);

    const { data: log } = await admin
      .from('notification_digest_log')
      .select('tipo, periodo_iso, channel, resend_email_id')
      .eq('consultora_id', A.consultoraId)
      .eq('periodo_iso', '2026-W22');
    expect(log).toHaveLength(1);
    expect(log![0]!.tipo).toBe('epp_weekly_summary');
    expect(log![0]!.channel).toBe('email');
    expect(log![0]!.resend_email_id).toMatch(/^rsd_test_/);
  });

  it('5. idempotencia: 2x mismo (consultora, periodo) -> 1 row + 1 Resend', async () => {
    const { armarResumenEpp } = await import('@/shared/notifications/digests/epp-weekly-data');
    const { sendEppWeeklySummary } = await import('@/shared/notifications/digests/epp-weekly');
    const now = new Date();
    const desde = new Date(now.getTime() - 7 * DAY).toISOString();
    const hasta = new Date(now.getTime() + 7 * DAY).toISOString();
    const resumen = await armarResumenEpp(admin, A.consultoraId, desde, now.toISOString(), hasta);

    // Periodo distinto del test 4 para aislar.
    const r1 = await sendEppWeeklySummary(
      admin,
      { id: A.consultoraId, name: 'T109WS a' },
      resumen,
      '2026-W23',
    );
    expect(r1.sent).toBe(true);
    expect(mockEmailsSend).toHaveBeenCalledTimes(1);

    const r2 = await sendEppWeeklySummary(
      admin,
      { id: A.consultoraId, name: 'T109WS a' },
      resumen,
      '2026-W23',
    );
    expect(r2.sent).toBe(false);
    if (!r2.sent) expect(r2.reason).toBe('already_sent');
    expect(mockEmailsSend).toHaveBeenCalledTimes(1); // sigue en 1

    const { data: log } = await admin
      .from('notification_digest_log')
      .select('id')
      .eq('consultora_id', A.consultoraId)
      .eq('periodo_iso', '2026-W23');
    expect(log).toHaveLength(1);
  });
});

describe('predicado "no email vacio"', () => {
  it('6. consultora sin actividad EPP -> resumen no accionable', async () => {
    const { armarResumenEpp, resumenEsAccionable } =
      await import('@/shared/notifications/digests/epp-weekly-data');
    const now = new Date();
    const desde = new Date(now.getTime() - 7 * DAY).toISOString();
    const hasta = new Date(now.getTime() + 7 * DAY).toISOString();

    const resumen = await armarResumenEpp(admin, vaciaId, desde, now.toISOString(), hasta);
    expect(resumen.entregas7d).toBe(0);
    expect(resumen.vencimientos7d).toHaveLength(0);
    expect(resumenEsAccionable(resumen)).toBe(false);
  });
});
