/**
 * T-027 · Tests cross-tenant + cascade de `public.calendar_events` y
 * `public.calendar_event_reminders`.
 *
 * Cobertura:
 * - RLS calendar_events: SELECT/INSERT/UPDATE policies (creator OR owner
 *   gate + created_by = auth.uid()). DELETE default-deny.
 * - RLS calendar_event_reminders: SELECT por member; INSERT/UPDATE/DELETE
 *   default-deny para authenticated (service-role only).
 * - ON DELETE CASCADE: consultora -> events -> reminders.
 * - Audit trigger: row escrita en audit_log al INSERT/UPDATE/DELETE de
 *   calendar_events con shape esperado + diff guard sobre campos mutables.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
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
const slugA = `t027-rls-a-${runId}`;
const slugB = `t027-rls-b-${runId}`;
const emailOwnerA = `t027-rls-owner-a-${runId}@example.com`;
const emailMemberA = `t027-rls-member-a-${runId}@example.com`;
const emailOwnerB = `t027-rls-owner-b-${runId}@example.com`;
const password = 'TestPassword123!';

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let clientOwnerA: SupabaseClient<Database>;
let clientMemberA: SupabaseClient<Database>;
let clientOwnerB: SupabaseClient<Database>;

/** Evento en cA creado por ownerA. */
let eventFixtureId: string;
/** Reminder asociado al eventFixture (insertado via admin). */
let reminderFixtureId: string;

function futureDateIso(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function futureTimestampz(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString();
}

beforeAll(async () => {
  // Consultoras.
  const [{ data: cA }, { data: cB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'T027 RLS cA', slug: slugA }).select('id').single(),
    admin.from('consultoras').insert({ name: 'T027 RLS cB', slug: slugB }).select('id').single(),
  ]);
  cAId = cA!.id;
  cBId = cB!.id;

  // Users.
  const [{ data: uOA }, { data: uMA }, { data: uOB }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailMemberA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true }),
  ]);
  ownerAId = uOA.user!.id;
  memberAId = uMA.user!.id;
  ownerBId = uOB.user!.id;

  // Memberships.
  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  // Claim JWT (T-016 fast-path).
  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);

  // Clientes anon con session firmada.
  const sbOA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbMA = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  const sbOB = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });
  await Promise.all([
    sbOA.auth.signInWithPassword({ email: emailOwnerA, password }),
    sbMA.auth.signInWithPassword({ email: emailMemberA, password }),
    sbOB.auth.signInWithPassword({ email: emailOwnerB, password }),
  ]);
  clientOwnerA = sbOA;
  clientMemberA = sbMA;
  clientOwnerB = sbOB;

  // Event fixture: creado por ownerA en cA.
  const { data: e } = await admin
    .from('calendar_events')
    .insert({
      consultora_id: cAId,
      tipo: 'rgrl_anual',
      titulo: 'T027 RLS fixture',
      fecha_vencimiento: futureDateIso(60),
      recurrence_months: 12,
      reminder_offsets_days: [60, 30, 7, 0],
      created_by: ownerAId,
    })
    .select('id')
    .single();
  eventFixtureId = e!.id;

  // Reminder fixture asociado.
  const { data: r } = await admin
    .from('calendar_event_reminders')
    .insert({
      event_id: eventFixtureId,
      consultora_id: cAId,
      offset_days: 30,
      scheduled_at: futureTimestampz(30),
    })
    .select('id')
    .single();
  reminderFixtureId = r!.id;
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
  ]);
});

describe('calendar_events RLS', () => {
  it('1. SELECT bloqueado para user de otra consultora', async () => {
    const { data } = await clientOwnerB
      .from('calendar_events')
      .select('id, titulo')
      .eq('id', eventFixtureId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('2. SELECT permitido para member de la consultora', async () => {
    // memberA es member de cA (no creator del evento). Aun asi puede VERLO.
    const { data } = await clientMemberA
      .from('calendar_events')
      .select('id, titulo')
      .eq('id', eventFixtureId)
      .maybeSingle();
    expect(data?.id).toBe(eventFixtureId);
  });

  it('3. INSERT permitido para member auto-atribuido', async () => {
    const { data, error } = await clientMemberA
      .from('calendar_events')
      .insert({
        consultora_id: cAId,
        tipo: 'capacitacion',
        titulo: 'Test capacitacion creada por member',
        fecha_vencimiento: futureDateIso(45),
        reminder_offsets_days: [30, 7, 0],
        created_by: memberAId,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it('4. INSERT bloqueado para consultora ajena (cross-tenant)', async () => {
    const { error } = await clientOwnerA.from('calendar_events').insert({
      consultora_id: cBId,
      tipo: 'protocolo_anual',
      titulo: 'Test cross tenant',
      fecha_vencimiento: futureDateIso(30),
      reminder_offsets_days: [30, 7, 0],
      created_by: ownerAId,
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('5. INSERT bloqueado si created_by != auth.uid() (usurpacion)', async () => {
    // ownerA intenta insertar con created_by = memberAId.
    const { error } = await clientOwnerA.from('calendar_events').insert({
      consultora_id: cAId,
      tipo: 'protocolo_anual',
      titulo: 'Spoof intent',
      fecha_vencimiento: futureDateIso(30),
      reminder_offsets_days: [30, 7, 0],
      created_by: memberAId, // != auth.uid()
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('6. UPDATE permitido para creator (status -> completed)', async () => {
    const completedAt = new Date().toISOString();
    const { data, error } = await clientOwnerA
      .from('calendar_events')
      .update({ status: 'completed', completed_at: completedAt, completed_by: ownerAId })
      .eq('id', eventFixtureId)
      .select('status, completed_at')
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe('completed');
    expect(data?.completed_at).toBeTruthy();

    // Rollback para mantener fixture utilizable en tests siguientes.
    await admin
      .from('calendar_events')
      .update({ status: 'pending', completed_at: null, completed_by: null })
      .eq('id', eventFixtureId);
  });

  it('7. UPDATE permitido para owner non-creator', async () => {
    // Evento creado por memberA, ownerA (owner) lo actualiza.
    const { data: e } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cAId,
        tipo: 'examen_medico',
        titulo: 'Created by member',
        fecha_vencimiento: futureDateIso(90),
        reminder_offsets_days: [30, 7, 0],
        created_by: memberAId,
      })
      .select('id')
      .single();

    const { data, error } = await clientOwnerA
      .from('calendar_events')
      .update({ titulo: 'Updated by owner' })
      .eq('id', e!.id)
      .select('titulo')
      .single();
    expect(error).toBeNull();
    expect(data?.titulo).toBe('Updated by owner');
  });

  it('8. UPDATE bloqueado para member non-creator non-owner', async () => {
    // eventFixture lo creo ownerA. memberA no es creator ni owner.
    const { data, error } = await clientMemberA
      .from('calendar_events')
      .update({ titulo: 'hijack attempt' })
      .eq('id', eventFixtureId)
      .select('id');
    // RLS USING filtra → 0 filas afectadas, sin error.
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    // Verificar que el titulo sigue siendo el original.
    const { data: still } = await admin
      .from('calendar_events')
      .select('titulo')
      .eq('id', eventFixtureId)
      .single();
    expect(still?.titulo).toBe('T027 RLS fixture');
  });

  it('9. UPDATE bloqueado cross-tenant', async () => {
    const { data, error } = await clientOwnerB
      .from('calendar_events')
      .update({ titulo: 'cross tenant hijack' })
      .eq('id', eventFixtureId)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('10. DELETE default-deny: creator no puede borrar via authenticated', async () => {
    // Insertar evento target via admin.
    const { data: target } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cAId,
        tipo: 'custom',
        titulo: 'Delete target',
        fecha_vencimiento: futureDateIso(30),
        reminder_offsets_days: [7, 0],
        created_by: ownerAId,
      })
      .select('id')
      .single();

    const { data, error } = await clientOwnerA
      .from('calendar_events')
      .delete()
      .eq('id', target!.id)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    // Sigue ahi.
    const { data: still } = await admin
      .from('calendar_events')
      .select('id')
      .eq('id', target!.id)
      .maybeSingle();
    expect(still?.id).toBe(target!.id);
  });

  it('11. DELETE consultora bloqueado por audit_log retention (invariante)', async () => {
    // Crear consultora aislada con evento. El INSERT del evento dispara el
    // audit trigger -> row en audit_log con consultora_id. audit_log.consultora_id
    // tiene FK `on delete restrict` (tenancy.sql:73) -> hard-delete de
    // consultoras esta bloqueado mientras haya audit. Soft-delete UX usa
    // `archived_at`. La cascade calendar_events.consultora_id existe en el
    // schema y se ejercita en test 12 (event -> reminders).
    const tmpSlug = `t027-restrict-${runId}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: tmpC } = await admin
      .from('consultoras')
      .insert({ name: 'T027 restrict', slug: tmpSlug })
      .select('id')
      .single();

    await admin
      .from('calendar_events')
      .insert({
        consultora_id: tmpC!.id,
        tipo: 'rgrl_anual',
        titulo: 'forces audit row',
        fecha_vencimiento: futureDateIso(30),
        reminder_offsets_days: [30, 0],
      })
      .select('id')
      .single();

    const { error: deleteError } = await admin.from('consultoras').delete().eq('id', tmpC!.id);
    expect(deleteError).not.toBeNull();
    expect(deleteError?.message.toLowerCase()).toMatch(/foreign key|violates|restrict/);

    // Consultora sigue ahi.
    const { data: still } = await admin
      .from('consultoras')
      .select('id')
      .eq('id', tmpC!.id)
      .maybeSingle();
    expect(still?.id).toBe(tmpC!.id);
  });

  it('12. cascade event -> reminders (DELETE solo del evento)', async () => {
    const { data: tmpE } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cAId,
        tipo: 'calibracion',
        titulo: 'evento con reminders',
        fecha_vencimiento: futureDateIso(60),
        reminder_offsets_days: [60, 14, 0],
        created_by: ownerAId,
      })
      .select('id')
      .single();

    await admin.from('calendar_event_reminders').insert([
      {
        event_id: tmpE!.id,
        consultora_id: cAId,
        offset_days: 60,
        scheduled_at: futureTimestampz(0),
      },
      {
        event_id: tmpE!.id,
        consultora_id: cAId,
        offset_days: 14,
        scheduled_at: futureTimestampz(46),
      },
      {
        event_id: tmpE!.id,
        consultora_id: cAId,
        offset_days: 0,
        scheduled_at: futureTimestampz(60),
      },
    ]);

    const { count: before } = await admin
      .from('calendar_event_reminders')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', tmpE!.id);
    expect(before).toBe(3);

    await admin.from('calendar_events').delete().eq('id', tmpE!.id);

    const { count: after } = await admin
      .from('calendar_event_reminders')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', tmpE!.id);
    expect(after).toBe(0);
  });
});

describe('calendar_event_reminders RLS', () => {
  it('13. SELECT permitido para member same-tenant', async () => {
    const { data } = await clientMemberA
      .from('calendar_event_reminders')
      .select('id, offset_days')
      .eq('id', reminderFixtureId)
      .maybeSingle();
    expect(data?.id).toBe(reminderFixtureId);
  });

  it('14. SELECT bloqueado cross-tenant', async () => {
    const { data } = await clientOwnerB
      .from('calendar_event_reminders')
      .select('id, offset_days')
      .eq('id', reminderFixtureId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('15. INSERT bloqueado para authenticated (sin policy)', async () => {
    // ownerA (creator del event) intenta insertar reminder via session client.
    const { error } = await clientOwnerA.from('calendar_event_reminders').insert({
      event_id: eventFixtureId,
      consultora_id: cAId,
      offset_days: 14,
      scheduled_at: futureTimestampz(46),
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });
});

describe('calendar_events audit_log', () => {
  it('16. audit_log: INSERT escribe row con shape esperado', async () => {
    const { data: target } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cAId,
        tipo: 'epp_entrega',
        titulo: 'Audit insert test',
        fecha_vencimiento: futureDateIso(180),
        recurrence_months: 6,
        reminder_offsets_days: [14, 3, 0],
        created_by: ownerAId,
      })
      .select('id')
      .single();

    const { data: log } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, before_data, after_data, consultora_id')
      .eq('entity_type', 'calendar_events')
      .eq('entity_id', target!.id)
      .eq('action', 'created')
      .single();

    expect(log?.action).toBe('created');
    expect(log?.entity_type).toBe('calendar_events');
    expect(log?.consultora_id).toBe(cAId);
    expect(log?.before_data).toBeNull();
    const after = log?.after_data as Record<string, unknown>;
    expect(after.tipo).toBe('epp_entrega');
    expect(after.titulo).toBe('Audit insert test');
    expect(after.status).toBe('pending');
    expect(after.recurrence_months).toBe(6);
    // Defensivo: payload NO debe contener descripcion ni reminder_offsets_days.
    expect(after.descripcion).toBeUndefined();
    expect(after.reminder_offsets_days).toBeUndefined();
  });

  it('17. audit_log: UPDATE en campo del diff guard escribe row', async () => {
    const { data: target } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cAId,
        tipo: 'protocolo_anual',
        titulo: 'audit update test',
        fecha_vencimiento: futureDateIso(120),
        reminder_offsets_days: [30, 7, 0],
        created_by: ownerAId,
      })
      .select('id')
      .single();

    await admin
      .from('calendar_events')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', target!.id);

    const { data: updates } = await admin
      .from('audit_log')
      .select('before_data, after_data')
      .eq('entity_type', 'calendar_events')
      .eq('entity_id', target!.id)
      .eq('action', 'updated');

    expect(updates?.length).toBe(1);
    const row = updates![0]!;
    const before = row.before_data as Record<string, unknown>;
    const after = row.after_data as Record<string, unknown>;
    expect(before.status).toBe('pending');
    expect(after.status).toBe('completed');
  });

  it('18. audit_log: UPDATE de campo fuera del diff guard NO escribe row', async () => {
    const { data: target } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cAId,
        tipo: 'custom',
        titulo: 'audit noop test',
        fecha_vencimiento: futureDateIso(30),
        reminder_offsets_days: [7, 0],
        metadata: { foo: 'bar' },
        created_by: ownerAId,
      })
      .select('id')
      .single();

    // metadata NO esta en el diff guard → UPDATE no debe generar audit.
    await admin
      .from('calendar_events')
      .update({ metadata: { foo: 'baz' } })
      .eq('id', target!.id);

    const { data: updates } = await admin
      .from('audit_log')
      .select('id')
      .eq('entity_type', 'calendar_events')
      .eq('entity_id', target!.id)
      .eq('action', 'updated');
    expect(updates?.length ?? 0).toBe(0);
  });

  it('19. audit_log: DELETE escribe row con before_data', async () => {
    const { data: target } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cAId,
        tipo: 'capacitacion',
        titulo: 'audit delete test',
        fecha_vencimiento: futureDateIso(30),
        reminder_offsets_days: [30, 7, 0],
        created_by: ownerAId,
      })
      .select('id')
      .single();

    await admin.from('calendar_events').delete().eq('id', target!.id);

    const { data: log } = await admin
      .from('audit_log')
      .select('action, before_data, after_data')
      .eq('entity_type', 'calendar_events')
      .eq('entity_id', target!.id)
      .eq('action', 'deleted')
      .single();

    expect(log?.action).toBe('deleted');
    expect(log?.after_data).toBeNull();
    const before = log?.before_data as Record<string, unknown>;
    expect(before.titulo).toBe('audit delete test');
    expect(before.tipo).toBe('capacitacion');
    expect(before.status).toBe('pending');
  });
});
