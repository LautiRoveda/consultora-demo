/**
 * T-122 · Integration: sync consultoras.plan/trial_hasta desde suscripciones
 * (trigger sync_consultora_plan_after_change, AFTER INSERT OR UPDATE OF estado).
 *
 * El trigger mantiene el cache denormalizado consultoras.plan/trial_hasta en sync
 * con el estado VIGENTE de la suscripción de la consultora:
 *   suscripción en (activa, morosa, cancelada) -> plan='pro' + trial_hasta=NULL
 *   resto (trial, pendiente_autorizacion, expirada) -> plan='trial' (trial_hasta intacto)
 *
 * "Vigente, no NEW": recomputa con un EXISTS sobre TODAS las suscripciones de la
 * consultora, así un evento sobre una fila histórica no degrada a una consultora
 * que sigue activa.
 *
 * Cobertura:
 *  1. INSERT estado=activa            -> plan=pro, trial_hasta=NULL (rama INSERT).
 *  2. UPDATE pendiente -> activa      -> plan=pro, trial_hasta=NULL.
 *  3. UPDATE activa -> morosa         -> sigue pro.
 *  4. UPDATE activa -> cancelada      -> sigue pro.
 *  5. UPDATE de solo cancelar_en      -> consultora intacta (scoping UPDATE OF estado).
 *  6. INSERT pendiente sobre trial    -> plan=trial, trial_hasta INTACTO (no clobber).
 *  7. Vigente                         -> evento sobre fila histórica NO degrada la viva.
 *  8. Idempotencia                    -> re-set estado=activa = no-op (updated_at sin cambios).
 *  9. Cross-tenant                    -> mutar suscripciones de A no toca el plan de B.
 *
 * El backfill (promote-only) de la misma migración se verifica al `db push`
 * (pre/post conteo + raise notice), no en CI: las migraciones ya están aplicadas
 * antes de seedear el test DB. Estos tests cubren la misma lógica de UPDATE forward.
 *
 * Mismo harness que t118-sync-calendar-to-origin.test.ts: service-role admin, runId
 * namespacing, consultora fresca por test (sin acoplamiento de orden).
 *
 * Correr local (Supabase efímero, requiere Docker):
 *   pnpm test:integration src/tests/integration/t122-consultora-plan-sync.test.ts
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

// Consultoras creadas (cleanup en afterAll; el FK suscripciones->consultoras es
// ON DELETE CASCADE, así borrar la consultora limpia sus suscripciones).
const createdConsultoras: string[] = [];

/** Crea una consultora fresca (plan='trial' + trial_hasta vigente por default). */
async function freshConsultora(opts?: {
  plan?: Database['public']['Tables']['consultoras']['Insert']['plan'];
  trialHasta?: string | null;
}): Promise<string> {
  const slug = `t122-${runId}-${nextSeq()}`;
  const { id } = await createTestConsultora(admin, {
    name: `T122 ${slug}`,
    slug,
    plan: opts?.plan,
    trialHasta: opts?.trialHasta,
  });
  createdConsultoras.push(id);
  return id;
}

/** Inserta una suscripción para la consultora y devuelve su id. */
async function insertSub(consultoraId: string, estado: EstadoSus): Promise<string> {
  const now = Date.now();
  const { data, error } = await admin
    .from('suscripciones')
    .insert({
      consultora_id: consultoraId,
      plan_codigo: 'pro_mensual',
      estado,
      mp_subscription_id: `t122-sub-${runId}-${nextSeq()}`,
      periodo_inicio: new Date(now).toISOString(),
      periodo_fin: new Date(now + THIRTY_DAYS_MS).toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertSub(${estado}): ${error?.message ?? 'sin row'}`);
  return data.id;
}

async function getConsultora(id: string): Promise<{
  plan: string;
  trial_hasta: string | null;
  updated_at: string;
}> {
  const { data, error } = await admin
    .from('consultoras')
    .select('plan, trial_hasta, updated_at')
    .eq('id', id)
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error(`getConsultora(${id}): sin row`);
  return data;
}

afterAll(async () => {
  if (createdConsultoras.length > 0) {
    await admin.from('consultoras').delete().in('id', createdConsultoras);
  }
});

describe('T-122 · sync consultoras.plan desde suscripciones (trigger)', () => {
  it('1. INSERT estado=activa -> plan=pro, trial_hasta=NULL', async () => {
    const c = await freshConsultora();
    await insertSub(c, 'activa');

    const cons = await getConsultora(c);
    expect(cons.plan).toBe('pro');
    expect(cons.trial_hasta).toBeNull();
  });

  it('2. UPDATE pendiente_autorizacion -> activa -> plan=pro, trial_hasta=NULL', async () => {
    const c = await freshConsultora();
    const sub = await insertSub(c, 'pendiente_autorizacion');

    // Sanity: pendiente no otorga pro.
    expect((await getConsultora(c)).plan).toBe('trial');

    const { error } = await admin.from('suscripciones').update({ estado: 'activa' }).eq('id', sub);
    expect(error).toBeNull();

    const cons = await getConsultora(c);
    expect(cons.plan).toBe('pro');
    expect(cons.trial_hasta).toBeNull();
  });

  it('3. UPDATE activa -> morosa -> sigue pro', async () => {
    const c = await freshConsultora();
    const sub = await insertSub(c, 'activa');
    expect((await getConsultora(c)).plan).toBe('pro');

    const { error } = await admin.from('suscripciones').update({ estado: 'morosa' }).eq('id', sub);
    expect(error).toBeNull();

    const cons = await getConsultora(c);
    expect(cons.plan).toBe('pro');
    expect(cons.trial_hasta).toBeNull();
  });

  it('4. UPDATE activa -> cancelada -> sigue pro', async () => {
    const c = await freshConsultora();
    const sub = await insertSub(c, 'activa');

    const { error } = await admin
      .from('suscripciones')
      .update({ estado: 'cancelada' })
      .eq('id', sub);
    expect(error).toBeNull();

    const cons = await getConsultora(c);
    expect(cons.plan).toBe('pro');
    expect(cons.trial_hasta).toBeNull();
  });

  it('5. UPDATE de solo cancelar_en (no estado) -> consultora intacta', async () => {
    const c = await freshConsultora();
    const sub = await insertSub(c, 'activa');
    const before = await getConsultora(c);
    expect(before.plan).toBe('pro');

    // UPDATE OF estado NO dispara: estado no está en el SET.
    const { error } = await admin
      .from('suscripciones')
      .update({ cancelar_en: new Date().toISOString() })
      .eq('id', sub);
    expect(error).toBeNull();

    const after = await getConsultora(c);
    expect(after.plan).toBe('pro');
    expect(after.trial_hasta).toBeNull();
    expect(after.updated_at).toBe(before.updated_at); // el trigger no corrió.
  });

  it('6. INSERT pendiente sobre trial -> plan=trial, trial_hasta INTACTO', async () => {
    const knownTrialHasta = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const c = await freshConsultora({ trialHasta: knownTrialHasta });

    await insertSub(c, 'pendiente_autorizacion');

    const cons = await getConsultora(c);
    expect(cons.plan).toBe('trial');
    expect(cons.trial_hasta).toBe(knownTrialHasta); // no clobber.
  });

  it('7. Vigente: evento sobre fila histórica NO degrada la suscripción viva', async () => {
    const c = await freshConsultora();
    const subHist = await insertSub(c, 'cancelada'); // histórica (paga)
    const subLive = await insertSub(c, 'activa'); // viva (paga)
    expect((await getConsultora(c)).plan).toBe('pro');

    // Un evento "stale" muta la fila histórica a expirada. Si el recompute usara
    // NEW.estado, degradaría a trial; como usa el VIGENTE (la activa existe), queda pro.
    const { error } = await admin
      .from('suscripciones')
      .update({ estado: 'expirada' })
      .eq('id', subHist);
    expect(error).toBeNull();

    expect((await getConsultora(c)).plan).toBe('pro');

    // Sanity inverso: al expirar TAMBIÉN la viva, ya no hay paga -> trial.
    const { error: err2 } = await admin
      .from('suscripciones')
      .update({ estado: 'expirada' })
      .eq('id', subLive);
    expect(err2).toBeNull();
    expect((await getConsultora(c)).plan).toBe('trial');
  });

  it('8. Idempotencia: re-set estado=activa = no-op (updated_at sin cambios)', async () => {
    const c = await freshConsultora();
    const sub = await insertSub(c, 'activa');
    const before = await getConsultora(c);
    expect(before.plan).toBe('pro');

    // Re-aplicar el mismo estado dispara el trigger, pero el guard is-distinct-from
    // evita el UPDATE de consultoras (plan ya es 'pro' y trial_hasta ya es NULL).
    const { error } = await admin.from('suscripciones').update({ estado: 'activa' }).eq('id', sub);
    expect(error).toBeNull();

    const after = await getConsultora(c);
    expect(after.plan).toBe('pro');
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('9. Cross-tenant: mutar suscripciones de A no toca el plan de B', async () => {
    const knownTrialHasta = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const a = await freshConsultora();
    const b = await freshConsultora({ trialHasta: knownTrialHasta });

    await insertSub(a, 'activa');
    expect((await getConsultora(a)).plan).toBe('pro');

    const consB = await getConsultora(b);
    expect(consB.plan).toBe('trial');
    expect(consB.trial_hasta).toBe(knownTrialHasta);
  });
});
