/**
 * T-121 (B) · Integration: audit_consultoras (AFTER INSERT/UPDATE -> audit_log).
 *
 * Cobertura:
 *  1. INSERT de consultora -> audit row 'created' (entity_type='consultoras').
 *  2. UPDATE directo de plan -> audit row 'updated' con before/after plan.
 *  3. Flip vía T-122 (update suscripciones.estado -> activa) -> audit row plan
 *     trial->pro con actor_user_id NULL (contexto service-role/cron: auth.uid()=NULL,
 *     audit_log.actor_user_id es nullable).
 *  4. UPDATE no-mutante (solo logo_storage_path, EXCLUIDO del diff-guard) -> SIN
 *     audit row (T-024: el logo va a pino+Sentry, no a audit_log).
 *
 * service-role admin: auth.uid() = NULL -> demuestra el "actor NULL tolerado".
 * Mismo harness que t122-consultora-plan-sync.test.ts.
 *
 * Correr local (Supabase efímero, requiere Docker):
 *   pnpm test:integration src/tests/integration/t121-audit-consultoras.test.ts
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
type AuditRow = {
  action: string;
  actor_user_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
};

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

let seq = 0;
function nextSeq(): number {
  seq += 1;
  return seq;
}

const createdConsultoras: string[] = [];

async function freshConsultora(): Promise<string> {
  const slug = `t121-${runId}-${nextSeq()}`;
  const { id } = await createTestConsultora(admin, { name: `T121 ${slug}`, slug });
  createdConsultoras.push(id);
  return id;
}

async function insertSub(consultoraId: string, estado: EstadoSus): Promise<string> {
  const now = Date.now();
  const { data, error } = await admin
    .from('suscripciones')
    .insert({
      consultora_id: consultoraId,
      plan_codigo: 'pro_mensual',
      estado,
      mp_subscription_id: `t121-sub-${runId}-${nextSeq()}`,
      periodo_inicio: new Date(now).toISOString(),
      periodo_fin: new Date(now + THIRTY_DAYS_MS).toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertSub(${estado}): ${error?.message ?? 'sin row'}`);
  return data.id;
}

/** Filas de audit_log de consultoras para una consultora, por action, en orden. */
async function auditRows(consultoraId: string, action: string): Promise<AuditRow[]> {
  const { data, error } = await admin
    .from('audit_log')
    .select('action, actor_user_id, before_data, after_data')
    .eq('entity_type', 'consultoras')
    .eq('entity_id', consultoraId)
    .eq('action', action)
    .order('created_at', { ascending: true });
  expect(error).toBeNull();
  return (data ?? []) as AuditRow[];
}

afterAll(async () => {
  // Best-effort: las consultoras con historial de audit no se pueden hard-deletar
  // (audit_log -> consultoras RESTRICT + inmutable). El db reset de CI limpia entre runs.
  if (createdConsultoras.length > 0) {
    await admin
      .from('consultoras')
      .delete()
      .in('id', createdConsultoras)
      .then(() => {});
  }
});

describe('T-121 · audit_consultoras', () => {
  it('1. INSERT de consultora -> audit row "created" con plan en after_data', async () => {
    const c = await freshConsultora();
    const created = await auditRows(c, 'created');
    expect(created).toHaveLength(1);
    expect(created[0]!.after_data?.plan).toBe('trial');
    expect(created[0]!.before_data).toBeNull();
  });

  it('2. UPDATE directo de plan -> audit row "updated" con before/after plan', async () => {
    const c = await freshConsultora();

    const { error } = await admin.from('consultoras').update({ plan: 'pro' }).eq('id', c);
    expect(error).toBeNull();

    const updated = await auditRows(c, 'updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.before_data?.plan).toBe('trial');
    expect(updated[0]!.after_data?.plan).toBe('pro');
  });

  it('3. Flip vía T-122 (suscripcion -> activa) -> audit "updated" plan trial->pro, actor NULL', async () => {
    const c = await freshConsultora();

    // pendiente_autorizacion NO flipea (plan sigue trial -> guard T-122 no-op -> sin audit row).
    const sub = await insertSub(c, 'pendiente_autorizacion');
    expect(await auditRows(c, 'updated')).toHaveLength(0);

    // activa -> el trigger T-122 setea plan='pro' -> dispara audit_consultoras (actor NULL).
    const { error } = await admin.from('suscripciones').update({ estado: 'activa' }).eq('id', sub);
    expect(error).toBeNull();

    const updated = await auditRows(c, 'updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.before_data?.plan).toBe('trial');
    expect(updated[0]!.after_data?.plan).toBe('pro');
    // Contexto service-role/cron: auth.uid() = NULL -> actor_user_id NULL (columna nullable).
    expect(updated[0]!.actor_user_id).toBeNull();
  });

  it('4. UPDATE solo logo_storage_path (excluido del guard) -> SIN audit row', async () => {
    const c = await freshConsultora();
    expect(await auditRows(c, 'updated')).toHaveLength(0);

    const { error } = await admin
      .from('consultoras')
      .update({ logo_storage_path: `${c}/logo-1.png` })
      .eq('id', c);
    expect(error).toBeNull();

    // logo_storage_path no está en el diff-guard -> el cambio NO genera fila de audit.
    expect(await auditRows(c, 'updated')).toHaveLength(0);
  });
});
