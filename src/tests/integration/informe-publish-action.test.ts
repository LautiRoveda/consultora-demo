/**
 * T-036 · Tests integration de `publishInformeAction` + `unpublishInformeAction`.
 *
 * Cubre:
 *  1. EMPTY_CONTENT (validacion pre-publish).
 *  2. Happy path tipo rgrl + toggle OFF -> status=published + autoCreatedEventId=null.
 *  3. Silent path tipo rgrl + toggle ON -> autoCreatedEventId populado + evento en DB.
 *  4. Silent path tipo accidente + toggle ON -> published pero NO crea evento.
 *  5. Idempotency: ya published -> ok sin re-disparar silent path.
 *  6. Unpublish published -> draft. Evento vinculado NO se borra.
 *  7. Unpublish draft -> idempotente.
 *  8. Permission gate: member non-creator non-owner -> FORBIDDEN.
 *  9. Cross-tenant: SELECT filtra via RLS -> NOT_FOUND.
 *
 * Mocks identicos a informes-actions.test.ts (T-019): server-only no-op +
 * next/headers.cookies con store mutable + next/cache.revalidatePath stub.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration -- informe-publish-action`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `t036-pub-${runId}`;
const slugOther = `t036-pub-other-${runId}`;
const ownerEmail = `t036-pub-owner-${runId}@example.com`;
const memberEmail = `t036-pub-member-${runId}@example.com`;
const otherOwnerEmail = `t036-pub-other-${runId}@example.com`;
const password = 'TestPassword123!';

let consultoraId: string;
let consultoraOtherId: string;
let ownerId: string;
let memberId: string;
let otherOwnerId: string;

// ---- Setup ---------------------------------------------------------------

async function signinAs(email: string) {
  cookieStore.length = 0;
  const { createClient } = await import('@/shared/supabase/server');
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function setToggle(value: boolean) {
  await admin
    .from('consultoras')
    .update({ auto_create_event_on_sign: value })
    .eq('id', consultoraId);
}

async function createDraftInforme(args: {
  tipo: 'rgrl' | 'accidente' | 'capacitacion' | 'relevamiento' | 'otros';
  titulo: string;
  contenido: string | null;
  createdBy?: string;
  consultoraOverride?: string;
}): Promise<string> {
  const { data, error } = await admin
    .from('informes')
    .insert({
      consultora_id: args.consultoraOverride ?? consultoraId,
      tipo: args.tipo,
      titulo: args.titulo,
      contenido: args.contenido,
      status: 'draft',
      created_by: args.createdBy ?? ownerId,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

beforeAll(async () => {
  // Consultora principal cA con su owner + un member non-owner.
  const { data: cA } = await admin
    .from('consultoras')
    .insert({ name: 'T036 Publish Consultora', slug })
    .select('id')
    .single();
  consultoraId = cA!.id;

  const { data: cB } = await admin
    .from('consultoras')
    .insert({ name: 'T036 Publish Other Consultora', slug: slugOther })
    .select('id')
    .single();
  consultoraOtherId = cB!.id;

  const ownerRes = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
  });
  ownerId = ownerRes.data.user!.id;
  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: consultoraId, role: 'owner' });
  await admin.auth.admin.updateUserById(ownerId, {
    app_metadata: { consultora_id: consultoraId },
  });

  const memberRes = await admin.auth.admin.createUser({
    email: memberEmail,
    password,
    email_confirm: true,
  });
  memberId = memberRes.data.user!.id;
  await admin
    .from('consultora_members')
    .insert({ user_id: memberId, consultora_id: consultoraId, role: 'member' });
  await admin.auth.admin.updateUserById(memberId, {
    app_metadata: { consultora_id: consultoraId },
  });

  const otherRes = await admin.auth.admin.createUser({
    email: otherOwnerEmail,
    password,
    email_confirm: true,
  });
  otherOwnerId = otherRes.data.user!.id;
  await admin
    .from('consultora_members')
    .insert({ user_id: otherOwnerId, consultora_id: consultoraOtherId, role: 'owner' });
  await admin.auth.admin.updateUserById(otherOwnerId, {
    app_metadata: { consultora_id: consultoraOtherId },
  });
});

beforeEach(async () => {
  // Reset toggle a OFF antes de cada test (defensa contra leak entre tests).
  await setToggle(false);
});

afterAll(async () => {
  // Cleanup users + consultoras (cascade borra informes + events + members).
  await admin.auth.admin.deleteUser(ownerId).catch(() => {});
  await admin.auth.admin.deleteUser(memberId).catch(() => {});
  await admin.auth.admin.deleteUser(otherOwnerId).catch(() => {});
  try {
    await admin.from('consultoras').delete().eq('id', consultoraId);
  } catch {
    // ignore
  }
  try {
    await admin.from('consultoras').delete().eq('id', consultoraOtherId);
  } catch {
    // ignore
  }
});

// ---- Tests ---------------------------------------------------------------

describe('publishInformeAction', () => {
  it('1. contenido vacio -> EMPTY_CONTENT', async () => {
    await signinAs(ownerEmail);
    const informeId = await createDraftInforme({
      tipo: 'rgrl',
      titulo: 'Test empty',
      contenido: null,
    });

    const { publishInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await publishInformeAction(informeId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('EMPTY_CONTENT');

    // Verificar que NO cambio el status.
    const { data } = await admin.from('informes').select('status').eq('id', informeId).single();
    expect(data?.status).toBe('draft');
  });

  it('2. happy path tipo rgrl + toggle OFF -> published + autoCreatedEventId=null', async () => {
    await setToggle(false);
    await signinAs(ownerEmail);
    const informeId = await createDraftInforme({
      tipo: 'rgrl',
      titulo: 'Test rgrl toggle off',
      contenido: '# Contenido del informe\n\nTexto del cuerpo.',
    });

    const { publishInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await publishInformeAction(informeId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.informeId).toBe(informeId);
    expect(result.autoCreatedEventId).toBeNull();

    const { data } = await admin.from('informes').select('status').eq('id', informeId).single();
    expect(data?.status).toBe('published');

    // No se creo evento vinculado.
    const { data: events } = await admin
      .from('calendar_events')
      .select('id')
      .eq('informe_id', informeId);
    expect(events ?? []).toEqual([]);
  });

  it('3. silent path tipo rgrl + toggle ON -> autoCreatedEventId + evento en DB', async () => {
    await setToggle(true);
    await signinAs(ownerEmail);
    const informeId = await createDraftInforme({
      tipo: 'rgrl',
      titulo: 'RGRL Acme SA',
      contenido: '# RGRL Acme\n\nDatos del relevamiento.',
    });

    const { publishInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await publishInformeAction(informeId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.autoCreatedEventId).not.toBeNull();

    // Verificar evento creado con shape correcto.
    const { data: event } = await admin
      .from('calendar_events')
      .select(
        'tipo, titulo, fecha_vencimiento, informe_id, recurrence_months, reminder_offsets_days, created_by, consultora_id, status',
      )
      .eq('id', result.autoCreatedEventId!)
      .single();
    expect(event?.tipo).toBe('rgrl_anual');
    expect(event?.informe_id).toBe(informeId);
    expect(event?.recurrence_months).toBe(12);
    expect(event?.status).toBe('pending');
    expect(event?.created_by).toBe(ownerId);
    expect(event?.consultora_id).toBe(consultoraId);
    expect(event?.reminder_offsets_days).toEqual([60, 30, 7, 0]);

    // Fecha vencimiento ~ today + 12 meses (tolerancia 2 dias por ejecucion de tests).
    const today = new Date();
    const expected = new Date(today.getTime());
    expected.setUTCMonth(expected.getUTCMonth() + 12);
    const expectedIso = expected.toISOString().slice(0, 10);
    expect(event?.fecha_vencimiento).toBeDefined();
    const diff = Math.abs(
      new Date(event!.fecha_vencimiento).getTime() - new Date(expectedIso).getTime(),
    );
    expect(diff).toBeLessThanOrEqual(2 * 24 * 60 * 60 * 1000);

    // Reminders existen (4 offsets futuros = 4 reminders pending).
    const { data: reminders } = await admin
      .from('calendar_event_reminders')
      .select('id, status')
      .eq('event_id', result.autoCreatedEventId!);
    expect(reminders?.length).toBe(4);
    expect(reminders?.every((r) => r.status === 'pending')).toBe(true);
  });

  it('4. tipo accidente + toggle ON -> published pero NO crea evento', async () => {
    await setToggle(true);
    await signinAs(ownerEmail);
    const informeId = await createDraftInforme({
      tipo: 'accidente',
      titulo: 'Accidente leve operario',
      contenido: '# Descripcion\n\nTexto.',
    });

    const { publishInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await publishInformeAction(informeId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.autoCreatedEventId).toBeNull();

    const { data: events } = await admin
      .from('calendar_events')
      .select('id')
      .eq('informe_id', informeId);
    expect(events ?? []).toEqual([]);
  });

  it('5. ya published -> idempotente, ok sin re-disparar silent path', async () => {
    await setToggle(true);
    await signinAs(ownerEmail);
    const informeId = await createDraftInforme({
      tipo: 'rgrl',
      titulo: 'Idempotency test',
      contenido: '# X',
    });

    // Primer call: crea evento.
    const { publishInformeAction } = await import('@/app/(app)/informes/actions');
    const r1 = await publishInformeAction(informeId);
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error('unreachable');
    expect(r1.autoCreatedEventId).not.toBeNull();

    // Segundo call: idempotente. NO crea evento nuevo.
    const r2 = await publishInformeAction(informeId);
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error('unreachable');
    expect(r2.autoCreatedEventId).toBeNull();

    // Solo hay 1 evento vinculado.
    const { data: events } = await admin
      .from('calendar_events')
      .select('id')
      .eq('informe_id', informeId);
    expect(events?.length).toBe(1);
  });

  it('6. permission gate: member non-creator non-owner -> FORBIDDEN', async () => {
    await signinAs(memberEmail);
    // Informe creado por el owner. Member intenta publicarlo.
    const informeId = await createDraftInforme({
      tipo: 'rgrl',
      titulo: 'Permission gate',
      contenido: '# X',
      createdBy: ownerId,
    });

    const { publishInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await publishInformeAction(informeId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('FORBIDDEN');

    // Status sigue draft.
    const { data } = await admin.from('informes').select('status').eq('id', informeId).single();
    expect(data?.status).toBe('draft');
  });

  it('7. cross-tenant -> NOT_FOUND (RLS filtra el SELECT del informe)', async () => {
    // Informe en consultora cB.
    const informeId = await createDraftInforme({
      tipo: 'rgrl',
      titulo: 'Cross-tenant',
      contenido: '# X',
      createdBy: otherOwnerId,
      consultoraOverride: consultoraOtherId,
    });

    // owner de cA intenta publicar -> RLS lo filtra del SELECT.
    await signinAs(ownerEmail);
    const { publishInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await publishInformeAction(informeId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('NOT_FOUND');
  });

  it('8. UUID malformado -> INVALID_INPUT', async () => {
    await signinAs(ownerEmail);
    const { publishInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await publishInformeAction('not-a-uuid');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_INPUT');
  });
});

describe('unpublishInformeAction', () => {
  it('1. published -> draft. Evento vinculado NO se borra', async () => {
    await setToggle(true);
    await signinAs(ownerEmail);
    const informeId = await createDraftInforme({
      tipo: 'rgrl',
      titulo: 'Unpublish test',
      contenido: '# X',
    });

    // Publish + crea evento.
    const { publishInformeAction, unpublishInformeAction } =
      await import('@/app/(app)/informes/actions');
    const pubResult = await publishInformeAction(informeId);
    expect(pubResult.ok).toBe(true);
    if (!pubResult.ok) throw new Error('unreachable');
    const eventId = pubResult.autoCreatedEventId!;

    // Unpublish.
    const unResult = await unpublishInformeAction(informeId);
    expect(unResult.ok).toBe(true);

    const { data } = await admin.from('informes').select('status').eq('id', informeId).single();
    expect(data?.status).toBe('draft');

    // El evento sigue ahi.
    const { data: event } = await admin
      .from('calendar_events')
      .select('id, status')
      .eq('id', eventId)
      .single();
    expect(event?.id).toBe(eventId);
    expect(event?.status).toBe('pending');
  });

  it('2. ya draft -> idempotente', async () => {
    await signinAs(ownerEmail);
    const informeId = await createDraftInforme({
      tipo: 'rgrl',
      titulo: 'Idempotency unpublish',
      contenido: '# X',
    });

    const { unpublishInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await unpublishInformeAction(informeId);
    expect(result.ok).toBe(true);

    const { data } = await admin.from('informes').select('status').eq('id', informeId).single();
    expect(data?.status).toBe('draft');
  });

  it('3. permission gate: member non-creator non-owner -> FORBIDDEN', async () => {
    await signinAs(ownerEmail);
    const informeId = await createDraftInforme({
      tipo: 'rgrl',
      titulo: 'Unpublish permission gate',
      contenido: '# X',
      createdBy: ownerId,
    });

    const { publishInformeAction } = await import('@/app/(app)/informes/actions');
    await publishInformeAction(informeId);

    await signinAs(memberEmail);
    const { unpublishInformeAction } = await import('@/app/(app)/informes/actions');
    const result = await unpublishInformeAction(informeId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('FORBIDDEN');
  });
});
