/**
 * T-031 · Test del rpc `process_pending_reminders()`.
 *
 * Cobertura:
 * - Reminders pending due con event pending -> UPDATE status='sent'.
 * - Reminders pending due con event cancelled -> NO se procesan (JOIN filter).
 * - Reminders pending due con event completed -> idem (JOIN filter).
 * - Reminders future (scheduled_at > now) -> NO se procesan.
 * - Limit 100/tick: 105 due -> primer call procesa 100, segundo procesa 5.
 *
 * Strategy:
 * - beforeAll: redirige cron_dispatch_base_url a `http://localhost:99`
 *   (puerto cerrado, no escucha nadie). pg_net.http_post falla rapido
 *   pero la funcion SQL ya hizo UPDATE 'sent' independiente del HTTP.
 *   Defensa: no contamina el endpoint productivo con POSTs spurios.
 * - afterAll: restablece base_url al valor productivo
 *   `https://consultora-demo.test-ia.cloud` (asume que es el valor
 *   default cargado por la migration).
 *
 * SELECT FOR UPDATE SKIP LOCKED: no se testea concurrente (pool de
 * connections del cliente no garantiza connections separadas). Es una
 * property DB-level documentada en la migration.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `t031-cron-${runId}`;
const emailOwner = `t031-cron-owner-${runId}@example.com`;
const password = 'TestPassword123!';

let cId: string;
let ownerId: string;

/** Eventos creados para cubrir los casos. */
let eventPendingId: string;
let eventCancelledId: string;
let eventCompletedId: string;

function isoDaysAhead(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function scheduledAtPast(minutesAgo: number): string {
  const d = new Date(Date.now() - minutesAgo * 60_000);
  return d.toISOString();
}

function scheduledAtFuture(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return d.toISOString();
}

/**
 * Configura Vault para el test:
 * - cron_dispatch_secret: valor real (cualquier no-placeholder) para
 *   pasar el guard de la funcion.
 * - cron_dispatch_base_url: puerto local cerrado, evita POSTs spurios
 *   al endpoint productivo.
 */
async function configureVaultForTest() {
  await admin.rpc('set_cron_vault_secret', {
    secret_name: 'cron_dispatch_secret',
    new_value: 'test-cron-secret-do-not-use-in-prod',
  });
  await admin.rpc('set_cron_vault_secret', {
    secret_name: 'cron_dispatch_base_url',
    new_value: 'http://localhost:99',
  });
}

async function restoreVaultAfterTest() {
  // Restablece a placeholder para que el cron productivo NO dispare hasta
  // que Lautaro complete el setup. base_url vuelve al valor productivo.
  await admin.rpc('set_cron_vault_secret', {
    secret_name: 'cron_dispatch_secret',
    new_value: 'REPLACE_ME_POST_DEPLOY',
  });
  await admin.rpc('set_cron_vault_secret', {
    secret_name: 'cron_dispatch_base_url',
    new_value: 'https://consultora-demo.test-ia.cloud',
  });
}

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T031 cron', slug })
    .select('id')
    .single();
  cId = c!.id;

  const { data: u } = await admin.auth.admin.createUser({
    email: emailOwner,
    password,
    email_confirm: true,
  });
  ownerId = u.user!.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: cId, role: 'owner' });

  await admin.auth.admin.updateUserById(ownerId, { app_metadata: { consultora_id: cId } });

  // Crear 3 eventos: pending, cancelled, completed.
  const [{ data: eP }, { data: eX }, { data: eC }] = await Promise.all([
    admin
      .from('calendar_events')
      .insert({
        consultora_id: cId,
        tipo: 'custom',
        titulo: 'Cron test PENDING',
        fecha_vencimiento: isoDaysAhead(7),
        reminder_offsets_days: [7, 0],
        status: 'pending',
        created_by: ownerId,
      })
      .select('id')
      .single(),
    admin
      .from('calendar_events')
      .insert({
        consultora_id: cId,
        tipo: 'custom',
        titulo: 'Cron test CANCELLED',
        fecha_vencimiento: isoDaysAhead(7),
        reminder_offsets_days: [7, 0],
        status: 'cancelled',
        created_by: ownerId,
      })
      .select('id')
      .single(),
    admin
      .from('calendar_events')
      .insert({
        consultora_id: cId,
        tipo: 'custom',
        titulo: 'Cron test COMPLETED',
        fecha_vencimiento: isoDaysAhead(7),
        reminder_offsets_days: [7, 0],
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: ownerId,
        created_by: ownerId,
      })
      .select('id')
      .single(),
  ]);
  eventPendingId = eP!.id;
  eventCancelledId = eX!.id;
  eventCompletedId = eC!.id;

  await configureVaultForTest();
});

afterAll(async () => {
  await restoreVaultAfterTest().catch(() => {});
  await admin.auth.admin.deleteUser(ownerId).catch(() => {});
});

describe('process_pending_reminders() — JOIN filter sobre event.status', () => {
  it('1. Reminder pending due con event pending -> status=sent', async () => {
    const { data: r } = await admin
      .from('calendar_event_reminders')
      .insert({
        event_id: eventPendingId,
        consultora_id: cId,
        offset_days: 1,
        scheduled_at: scheduledAtPast(5),
        status: 'pending',
      })
      .select('id')
      .single();
    const reminderId = r!.id;

    await admin.rpc('process_pending_reminders');

    const { data: after } = await admin
      .from('calendar_event_reminders')
      .select('status, sent_at')
      .eq('id', reminderId)
      .single();

    expect(after?.status).toBe('sent');
    expect(after?.sent_at).toBeTruthy();
  });

  it('2. Reminder pending due con event cancelled -> NO procesado (sigue pending)', async () => {
    const { data: r } = await admin
      .from('calendar_event_reminders')
      .insert({
        event_id: eventCancelledId,
        consultora_id: cId,
        offset_days: 2,
        scheduled_at: scheduledAtPast(5),
        status: 'pending',
      })
      .select('id')
      .single();
    const reminderId = r!.id;

    await admin.rpc('process_pending_reminders');

    const { data: after } = await admin
      .from('calendar_event_reminders')
      .select('status, sent_at')
      .eq('id', reminderId)
      .single();

    expect(after?.status).toBe('pending');
    expect(after?.sent_at).toBeNull();
  });

  it('3. Reminder pending due con event completed -> NO procesado', async () => {
    const { data: r } = await admin
      .from('calendar_event_reminders')
      .insert({
        event_id: eventCompletedId,
        consultora_id: cId,
        offset_days: 3,
        scheduled_at: scheduledAtPast(5),
        status: 'pending',
      })
      .select('id')
      .single();
    const reminderId = r!.id;

    await admin.rpc('process_pending_reminders');

    const { data: after } = await admin
      .from('calendar_event_reminders')
      .select('status, sent_at')
      .eq('id', reminderId)
      .single();

    expect(after?.status).toBe('pending');
    expect(after?.sent_at).toBeNull();
  });

  it('4. Reminder future (scheduled_at > now) -> NO procesado', async () => {
    const { data: r } = await admin
      .from('calendar_event_reminders')
      .insert({
        event_id: eventPendingId,
        consultora_id: cId,
        offset_days: 4,
        scheduled_at: scheduledAtFuture(7),
        status: 'pending',
      })
      .select('id')
      .single();
    const reminderId = r!.id;

    await admin.rpc('process_pending_reminders');

    const { data: after } = await admin
      .from('calendar_event_reminders')
      .select('status, sent_at')
      .eq('id', reminderId)
      .single();

    expect(after?.status).toBe('pending');
    expect(after?.sent_at).toBeNull();
  });
});

describe('process_pending_reminders() — limit 100/tick', () => {
  it('5. Insertar 105 reminders due -> primer call procesa 100, segundo procesa 5', async () => {
    // Necesitamos 105 events pending distintos (cada event tiene UNIQUE
    // (event_id, offset_days) — no podemos meter 105 reminders sobre el
    // mismo event ni sobre distintos offsets dentro del mismo event).
    // Por eficiencia: 1 event + 105 offsets distintos (0..104). offset_days
    // CHECK acepta 0..365 -> 105 OK.

    const { data: ev } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cId,
        tipo: 'custom',
        titulo: 'Cron limit test',
        fecha_vencimiento: isoDaysAhead(120),
        reminder_offsets_days: [],
        status: 'pending',
        created_by: ownerId,
      })
      .select('id')
      .single();

    const remindersToInsert = Array.from({ length: 105 }, (_, i) => ({
      event_id: ev!.id,
      consultora_id: cId,
      offset_days: i + 200, // 200..304 (no choca con tests previos del mismo runId)
      scheduled_at: scheduledAtPast(10 - i / 1000), // pequeño jitter para orden estable
      status: 'pending' as const,
    }));

    // Workaround: el CHECK constraint requiere offset_days <= 365. Ajustamos
    // a 200..304 que cae dentro del rango.
    await admin.from('calendar_event_reminders').insert(remindersToInsert);

    // Verificar count inicial pending del event.
    const { count: beforeCount } = await admin
      .from('calendar_event_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev!.id)
      .eq('status', 'pending');
    expect(beforeCount).toBe(105);

    // Primer tick.
    await admin.rpc('process_pending_reminders');

    const { count: afterFirst } = await admin
      .from('calendar_event_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev!.id)
      .eq('status', 'sent');
    expect(afterFirst).toBe(100);

    // Segundo tick: procesa los 5 restantes.
    await admin.rpc('process_pending_reminders');

    const { count: afterSecond } = await admin
      .from('calendar_event_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev!.id)
      .eq('status', 'sent');
    expect(afterSecond).toBe(105);
  });
});
