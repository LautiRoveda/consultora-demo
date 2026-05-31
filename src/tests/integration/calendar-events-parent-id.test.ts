/**
 * T-036 · Tests integration de `parent_event_id` en calendar_events.
 *
 * Verifica:
 *  1. completeCalendarEventAction con recurrencia -> next event tiene
 *     parent_event_id = original.id (chain liga el next al original).
 *  2. Chain de 3 niveles: completar el next genera un next-next con
 *     parent_event_id = next.id (no apunta al original, sigue la cadena).
 *  3. Manual INSERT (sin via complete) tiene parent_event_id = null default.
 *  4. Audit log del INSERT del next captura parent_event_id en after_data.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
  cookies: () =>
    Promise.resolve({
      getAll: () => cookieStore.map((c) => ({ name: c.name, value: c.value })),
      set: (name: string, value: string) => {
        const idx = cookieStore.findIndex((c) => c.name === name);
        if (idx >= 0) cookieStore[idx] = { name, value };
        else cookieStore.push({ name, value });
      },
    }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

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
const slug = `t036-parent-${runId}`;
const email = `t036-parent-${runId}@example.com`;
const password = 'TestPassword123!';

let consultoraId: string;
let userId: string;

async function signin() {
  cookieStore.length = 0;
  const { createClient } = await import('@/shared/supabase/server');
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function createEvent(args: {
  tipo: 'rgrl_anual' | 'capacitacion' | 'custom';
  titulo: string;
  fechaIso: string;
  recurrenceMonths?: number | null;
}): Promise<string> {
  const { data, error } = await admin
    .from('calendar_events')
    .insert({
      consultora_id: consultoraId,
      tipo: args.tipo,
      titulo: args.titulo,
      fecha_vencimiento: args.fechaIso,
      recurrence_months: args.recurrenceMonths ?? null,
      reminder_offsets_days: [7, 0],
      created_by: userId,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T036 Parent Consultora', slug })
    .select('id')
    .single();
  consultoraId = c!.id;

  const { data: u } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  userId = u.user!.id;

  await admin
    .from('consultora_members')
    .insert({ user_id: userId, consultora_id: consultoraId, role: 'owner' });
  await admin.auth.admin.updateUserById(userId, {
    app_metadata: { consultora_id: consultoraId },
  });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userId).catch(() => {});
  try {
    await admin.from('consultoras').delete().eq('id', consultoraId);
  } catch {
    // ignore
  }
});

describe('parent_event_id propagation', () => {
  it('1. complete con recurrence_months -> next event tiene parent_event_id = original.id', async () => {
    await signin();
    const originalId = await createEvent({
      tipo: 'rgrl_anual',
      titulo: 'Original RGRL',
      fechaIso: '2026-12-01',
      recurrenceMonths: 12,
    });

    const { completeCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await completeCalendarEventAction(originalId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.nextEventId).not.toBeNull();

    const { data: nextEvent } = await admin
      .from('calendar_events')
      .select('id, parent_event_id, recurrence_months, fecha_vencimiento')
      .eq('id', result.nextEventId!)
      .single();
    expect(nextEvent?.parent_event_id).toBe(originalId);
    expect(nextEvent?.recurrence_months).toBe(12);
    // Fecha = 2026-12-01 + 12m = 2027-12-01.
    expect(nextEvent?.fecha_vencimiento).toBe('2027-12-01');
  });

  it('2. chain de 3 niveles: completar el next genera next-next con parent_event_id = next.id', async () => {
    await signin();
    const originalId = await createEvent({
      tipo: 'capacitacion',
      titulo: 'Chain Original',
      fechaIso: '2026-10-15',
      recurrenceMonths: 6,
    });

    const { completeCalendarEventAction } = await import('@/app/(app)/calendario/actions');

    // Nivel 1 -> 2.
    const r1 = await completeCalendarEventAction(originalId);
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error('unreachable');
    const nextId = r1.nextEventId!;
    expect(nextId).not.toBeNull();

    // Nivel 2 -> 3.
    const r2 = await completeCalendarEventAction(nextId);
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error('unreachable');
    const nextNextId = r2.nextEventId!;
    expect(nextNextId).not.toBeNull();

    const { data: nextEvent } = await admin
      .from('calendar_events')
      .select('parent_event_id')
      .eq('id', nextId)
      .single();
    expect(nextEvent?.parent_event_id).toBe(originalId);

    const { data: nextNextEvent } = await admin
      .from('calendar_events')
      .select('parent_event_id, fecha_vencimiento')
      .eq('id', nextNextId)
      .single();
    expect(nextNextEvent?.parent_event_id).toBe(nextId);
    // Fecha del nivel 3 = 2026-10-15 + 12m (6m + 6m) = 2027-10-15.
    expect(nextNextEvent?.fecha_vencimiento).toBe('2027-10-15');
  });

  it('3. evento manual (sin recurrencia) -> parent_event_id default null', async () => {
    const eventId = await createEvent({
      tipo: 'custom',
      titulo: 'Manual sin parent',
      fechaIso: '2026-11-01',
    });
    const { data } = await admin
      .from('calendar_events')
      .select('parent_event_id, informe_id')
      .eq('id', eventId)
      .single();
    expect(data?.parent_event_id).toBeNull();
    expect(data?.informe_id).toBeNull();
  });

  it('4. audit_log del INSERT del next captura parent_event_id en after_data', async () => {
    await signin();
    const originalId = await createEvent({
      tipo: 'rgrl_anual',
      titulo: 'Audit chain',
      fechaIso: '2026-09-01',
      recurrenceMonths: 12,
    });

    const { completeCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await completeCalendarEventAction(originalId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const nextId = result.nextEventId!;

    // Audit row del INSERT del next.
    const { data: auditRow } = await admin
      .from('audit_log')
      .select('action, entity_type, entity_id, after_data, before_data')
      .eq('entity_id', nextId)
      .eq('action', 'created')
      .single();

    expect(auditRow?.entity_type).toBe('calendar_events');
    expect(auditRow?.action).toBe('created');
    expect(auditRow?.before_data).toBeNull();
    // El payload after_data incluye parent_event_id (ajuste del audit trigger T-036).
    const afterData = auditRow?.after_data as Record<string, unknown> | null;
    expect(afterData?.parent_event_id).toBe(originalId);
  });
});
