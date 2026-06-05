/**
 * T-124 · Integration: churn reaper `process_subscription_churn()` + ALTER del CHECK
 * de calendar_event_reminders (quita 'failed').
 *
 * El reaper flipa las suscripciones 'cancelada' cuyo período de acceso terminó a
 * 'expirada':
 *   estado='cancelada' AND (cancelar_en IS NULL OR cancelar_en < now()) -> 'expirada'
 * El UPDATE de estado dispara el trigger T-122 (sync_consultora_plan_after_change)
 * -> recomputa consultoras.plan='trial'. Una cancelada con cancelar_en futuro (gracia
 * viva) NO se toca. Idempotente.
 *
 * El reaper es un SWEEP GLOBAL (sin filtro por consultora) -> asertamos SIEMPRE sobre
 * las filas propias (su consultora_id / sub id), nunca sobre el conteo de retorno
 * (frágil con DB compartida serial). Mismo patrón que billing-dunning-cron /
 * epp-weekly-summary-cron. Consultora fresca por test (sin acoplamiento de orden);
 * mismo harness que t122-consultora-plan-sync.test.ts.
 *
 * Correr local (Supabase efímero, requiere Docker):
 *   pnpm test:integration src/tests/integration/t124-churn-reaper.test.ts
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import { createTestConsultora } from '@/tests/integration/helpers/consultora';

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

type EstadoSus = Database['public']['Enums']['estado_suscripcion'];

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

let seq = 0;
function nextSeq(): number {
  seq += 1;
  return seq;
}

// Cleanup en afterAll; FK suscripciones->consultoras y calendar_events->consultoras son
// ON DELETE CASCADE, así borrar la consultora limpia sus filas hijas.
const createdConsultoras: string[] = [];

async function freshConsultora(): Promise<string> {
  const slug = `t124-${runId}-${nextSeq()}`;
  const { id } = await createTestConsultora(admin, { name: `T124 ${slug}`, slug });
  createdConsultoras.push(id);
  return id;
}

/** Inserta una suscripción (dispara T-122 en el INSERT) y devuelve su id. */
async function insertSub(
  consultoraId: string,
  estado: EstadoSus,
  cancelarEn?: string | null,
): Promise<string> {
  const now = Date.now();
  const { data, error } = await admin
    .from('suscripciones')
    .insert({
      consultora_id: consultoraId,
      plan_codigo: 'pro_mensual',
      estado,
      mp_subscription_id: `t124-sub-${runId}-${nextSeq()}`,
      periodo_inicio: new Date(now).toISOString(),
      periodo_fin: new Date(now + THIRTY_DAYS_MS).toISOString(),
      cancelar_en: cancelarEn ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertSub(${estado}): ${error?.message ?? 'sin row'}`);
  return data.id;
}

async function getSubEstado(id: string): Promise<string> {
  const { data, error } = await admin.from('suscripciones').select('estado').eq('id', id).single();
  expect(error).toBeNull();
  if (!data) throw new Error(`getSubEstado(${id}): sin row`);
  return data.estado;
}

async function getConsultora(id: string): Promise<{ plan: string; updated_at: string }> {
  const { data, error } = await admin
    .from('consultoras')
    .select('plan, updated_at')
    .eq('id', id)
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error(`getConsultora(${id}): sin row`);
  return data;
}

async function runReaper(): Promise<void> {
  const { error } = await admin.rpc('process_subscription_churn');
  expect(error).toBeNull();
}

afterAll(async () => {
  if (createdConsultoras.length > 0) {
    await admin.from('consultoras').delete().in('id', createdConsultoras);
  }
});

describe('T-124 · churn reaper process_subscription_churn()', () => {
  it('1. cancelada + cancelar_en NULL -> expirada + consultoras.plan=trial', async () => {
    const c = await freshConsultora();
    const sub = await insertSub(c, 'cancelada', null);
    // INSERT cancelada dispara T-122 -> plan=pro (cancelada es pago-significativa).
    expect((await getConsultora(c)).plan).toBe('pro');

    await runReaper();

    expect(await getSubEstado(sub)).toBe('expirada');
    expect((await getConsultora(c)).plan).toBe('trial');
  });

  it('2. cancelada + cancelar_en PASADO -> expirada + consultoras.plan=trial', async () => {
    const c = await freshConsultora();
    const past = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const sub = await insertSub(c, 'cancelada', past);
    expect((await getConsultora(c)).plan).toBe('pro');

    await runReaper();

    expect(await getSubEstado(sub)).toBe('expirada');
    expect((await getConsultora(c)).plan).toBe('trial');
  });

  it('3. cancelada + cancelar_en FUTURO (gracia viva) -> NO se toca', async () => {
    const c = await freshConsultora();
    const future = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
    const sub = await insertSub(c, 'cancelada', future);
    expect((await getConsultora(c)).plan).toBe('pro');

    await runReaper();

    // Sigue cancelada (período de gracia no terminó) y plan sigue pro.
    expect(await getSubEstado(sub)).toBe('cancelada');
    expect((await getConsultora(c)).plan).toBe('pro');
  });

  it('4. Idempotencia: 2da corrida no re-toca la fila ya expirada (consultora.updated_at estable)', async () => {
    const c = await freshConsultora();
    const sub = await insertSub(c, 'cancelada', null);

    await runReaper();
    expect(await getSubEstado(sub)).toBe('expirada');
    const after1 = await getConsultora(c);
    expect(after1.plan).toBe('trial');

    // 2da corrida: la fila ya es 'expirada' -> el UPDATE no la matchea -> T-122 no
    // dispara para esta consultora -> updated_at sin cambios.
    await runReaper();
    const after2 = await getConsultora(c);
    expect(await getSubEstado(sub)).toBe('expirada');
    expect(after2.plan).toBe('trial');
    expect(after2.updated_at).toBe(after1.updated_at);
  });

  it('5. activa NO se toca (sólo se reapan canceladas)', async () => {
    const c = await freshConsultora();
    const sub = await insertSub(c, 'activa');
    expect((await getConsultora(c)).plan).toBe('pro');

    await runReaper();

    expect(await getSubEstado(sub)).toBe('activa');
    expect((await getConsultora(c)).plan).toBe('pro');
  });
});

describe('T-124 · CHECK calendar_event_reminders.status sin "failed"', () => {
  async function seedEvent(consultoraId: string): Promise<string> {
    const { data, error } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'custom',
        titulo: `T124 chk ${runId} ${nextSeq()}`,
        fecha_vencimiento: '2027-01-15',
        reminder_offsets_days: [7, 0],
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seedEvent: ${error?.message ?? 'sin row'}`);
    return data.id;
  }

  it('6a. INSERT reminder status=failed -> rechazado por el CHECK (23514)', async () => {
    const c = await freshConsultora();
    const eventId = await seedEvent(c);

    // status es `string` en los tipos generados (el CHECK vive en la DB, no en TS), así
    // 'failed' compila; el rechazo es en runtime (T-124 lo quitó del CHECK).
    const { error } = await admin.from('calendar_event_reminders').insert({
      event_id: eventId,
      consultora_id: c,
      offset_days: 7,
      scheduled_at: new Date().toISOString(),
      status: 'failed',
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514'); // check_violation
  });

  it('6b. INSERT reminder status=skipped -> aceptado (sigue siendo válido)', async () => {
    const c = await freshConsultora();
    const eventId = await seedEvent(c);

    const { error } = await admin.from('calendar_event_reminders').insert({
      event_id: eventId,
      consultora_id: c,
      offset_days: 0,
      scheduled_at: new Date().toISOString(),
      status: 'skipped',
    });
    expect(error).toBeNull();
  });
});
