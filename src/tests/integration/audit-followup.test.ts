/**
 * AUD-001 + AUD-002 · Audit RLS pre-launch follow-up tests.
 *
 * AUD-001 (billing_notifications_log immutability):
 *  a. INSERT via service_role → OK.
 *  b. UPDATE via service_role → raise exception "es inmutable".
 *  c. DELETE via service_role → raise exception "es inmutable".
 *
 * AUD-002 (epp_planificaciones default-deny INSERT para authenticated):
 *  a. INSERT via authenticated client (member del tenant) → 42501 RLS rejected.
 *  b. INVOKE gen_epp_planificaciones_y_calendar_for via service_role → genera
 *     planificacion exitosamente (regression: la function sigue funcionando).
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration src/tests/integration/audit-followup.test.ts`.
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
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `aud-${runId}`;
const emailOwner = `aud-owner-${runId}@example.com`;
const password = 'TestPassword123!';

let consultoraId: string;
let ownerId: string;
let clienteId: string;
let empleadoId: string;
let categoriaId: string;
let itemId: string;
let entregaId: string;
let clientOwner: SupabaseClient<Database>;

const billingLogIds: string[] = [];
const planifIdsFromRpc: string[] = [];

beforeAll(async () => {
  // Consultora
  const c = await admin
    .from('consultoras')
    .insert({ name: 'AUD followup', slug })
    .select('id')
    .single();
  if (c.error || !c.data) throw new Error(`insert consultora: ${JSON.stringify(c.error)}`);
  consultoraId = c.data.id;

  // Owner user
  const u = await admin.auth.admin.createUser({
    email: emailOwner,
    password,
    email_confirm: true,
  });
  if (u.error || !u.data.user) throw new Error(`createUser owner: ${JSON.stringify(u.error)}`);
  ownerId = u.data.user.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: consultoraId, role: 'owner' });

  // JWT claim fast-path
  await admin.auth.admin.updateUserById(ownerId, {
    app_metadata: { consultora_id: consultoraId, consultora_role: 'owner' },
  });

  // Authenticated client signed in as owner
  const sb = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const signIn = await sb.auth.signInWithPassword({ email: emailOwner, password });
  if (signIn.error) throw new Error(`signIn owner: ${JSON.stringify(signIn.error)}`);
  clientOwner = sb;

  // Fixtures EPP minimos para AUD-002 b (cliente + empleado + categoria + item + entrega)
  const cli = await admin
    .from('clientes')
    .insert({
      consultora_id: consultoraId,
      razon_social: 'AUD Cliente',
      cuit: '20-30123456-7',
      created_by: ownerId,
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
      nombre: 'AUD',
      apellido: 'Empleado',
      dni: '30123456',
      created_by: ownerId,
    })
    .select('id')
    .single();
  if (emp.error || !emp.data) throw new Error(`insert empleado: ${JSON.stringify(emp.error)}`);
  empleadoId = emp.data.id;

  const cat = await admin
    .from('epp_categorias')
    .insert({
      consultora_id: consultoraId,
      nombre: `AUD cat ${runId}`,
      created_by: ownerId,
    })
    .select('id')
    .single();
  if (cat.error || !cat.data) throw new Error(`insert categoria: ${JSON.stringify(cat.error)}`);
  categoriaId = cat.data.id;

  const item = await admin
    .from('epp_items')
    .insert({
      consultora_id: consultoraId,
      categoria_id: categoriaId,
      nombre: `AUD item ${runId}`,
      vida_util_meses: 6,
      es_descartable: false,
      requiere_numero_serie: false,
      created_by: ownerId,
    })
    .select('id')
    .single();
  if (item.error || !item.data) throw new Error(`insert item: ${JSON.stringify(item.error)}`);
  itemId = item.data.id;

  const ent = await admin
    .from('epp_entregas')
    .insert({
      consultora_id: consultoraId,
      empleado_id: empleadoId,
      cliente_id: clienteId,
      created_by: ownerId,
    })
    .select('id')
    .single();
  if (ent.error || !ent.data) throw new Error(`insert entrega: ${JSON.stringify(ent.error)}`);
  entregaId = ent.data.id;

  await admin.from('epp_entrega_items').insert({
    entrega_id: entregaId,
    item_id: itemId,
    consultora_id: consultoraId,
    cantidad: 1,
    motivo_entrega: 'inicial',
  });
});

afterAll(async () => {
  // Cleanup: admin bypassa RLS pero NO bypassa el nuevo trigger BEFORE DELETE
  // de billing_notifications_log (AUD-001) — un cascade DELETE de consultora
  // dispararia el trigger sobre el row insertado en el test AUD-001a y
  // raise exception => rollback de todo el cascade. Mismo patron que audit_log
  // (lessons-learned.md "Cascade DELETE bloqueado por audit_log retention").
  // Decision: dejar fixture row en DB de testing (cleanup admin manual). Solo
  // limpiamos el auth user. Los rows quedan identificados por slug `aud-${runId}`.
  await admin.auth.admin.deleteUser(ownerId).catch(() => {});
  void billingLogIds;
  void planifIdsFromRpc;
});

describe('AUD-001 · billing_notifications_log immutable', () => {
  it('a. INSERT via service_role → OK (insert-only sigue funcionando)', async () => {
    const { data, error } = await admin
      .from('billing_notifications_log')
      .insert({
        consultora_id: consultoraId,
        tipo: 'trial_expires_in_3d',
        ref_id: null,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    billingLogIds.push(data!.id);
  });

  it('b. UPDATE via service_role → raise exception "inmutable"', async () => {
    const id = billingLogIds[0];
    if (!id) throw new Error('AUD-001a no insertó row — fixture inválido');
    const { error } = await admin
      .from('billing_notifications_log')
      .update({ resend_email_id: 'tampered_value' })
      .eq('id', id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/inmutable/i);
  });

  it('c. DELETE via service_role → raise exception "inmutable"', async () => {
    const id = billingLogIds[0];
    if (!id) throw new Error('AUD-001a no insertó row — fixture inválido');
    const { error } = await admin.from('billing_notifications_log').delete().eq('id', id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/inmutable/i);
  });
});

describe('AUD-002 · epp_planificaciones default-deny INSERT authenticated', () => {
  it('a. INSERT via authenticated (member del tenant) → RLS rejected (42501)', async () => {
    const { error } = await clientOwner.from('epp_planificaciones').insert({
      consultora_id: consultoraId,
      empleado_id: empleadoId,
      item_id: itemId,
      fecha_proxima_entrega: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      frecuencia_meses: 6,
      generado_de_entrega_id: entregaId,
      estado: 'activa',
    });
    expect(error).not.toBeNull();
    // PostgREST mapea RLS violation a 42501 (insufficient_privilege) o
    // codigo PGRST cuando la check policy falla. Aceptamos ambos.
    expect(error?.code === '42501' || error?.code?.startsWith('PGRST')).toBe(true);
  });

  it('b. INVOKE gen_epp_planificaciones_y_calendar_for via service_role → genera planificacion', async () => {
    const { error: rpcError } = await admin.rpc('gen_epp_planificaciones_y_calendar_for', {
      p_entrega_id: entregaId,
    });
    expect(rpcError).toBeNull();

    // Verify planificacion fue creada para el item NO descartable.
    const { data: planifs, error: selError } = await admin
      .from('epp_planificaciones')
      .select('id, item_id, generado_de_entrega_id, estado')
      .eq('generado_de_entrega_id', entregaId);
    expect(selError).toBeNull();
    expect(planifs?.length ?? 0).toBeGreaterThanOrEqual(1);
    const created = planifs?.find((p) => p.item_id === itemId);
    expect(created).toBeDefined();
    expect(created?.estado).toBe('activa');
    if (created) planifIdsFromRpc.push(created.id);
  });
});
