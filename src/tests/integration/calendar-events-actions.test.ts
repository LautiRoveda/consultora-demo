/**
 * T-028 · Tests de integration de las server actions + queries del modulo
 * Calendario.
 *
 * Cobertura:
 *  - createCalendarEventAction: defaults por tipo (3 tipos), override custom,
 *    skip pasado + log warn, cross-tenant FORBIDDEN, member non-creator OK,
 *    INVALID_INPUT, UNAUTHENTICATED.
 *  - updateCalendarEventAction: gates (creator/owner/member), recompute por
 *    fecha, recompute por offsets (preserva sent/failed).
 *  - completeCalendarEventAction: sin recurrencia, con recurrencia 12 meses
 *    (informe_id=null en next event), ALREADY_FINAL, audit log row.
 *  - cancelCalendarEventAction: happy path con reason en metadata, NO
 *    auto-recurrencia (anti-test).
 *  - Queries: getUpcomingEvents, getOverdueEvents, cross-tenant.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
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

// Mock de logger para verificar warnings de skip-past sin afectar Sentry real.
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerInfoMock = vi.fn();
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: () => {},
    debug: () => {},
    info: (arg: unknown, msg?: string) => loggerInfoMock(arg, msg),
    warn: (arg: unknown, msg?: string) => loggerWarnMock(arg, msg),
    error: (arg: unknown, msg?: string) => loggerErrorMock(arg, msg),
    fatal: () => {},
  },
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
const password = 'TestPassword123!';

const slugA = `t028a-${runId}`;
const slugB = `t028b-${runId}`;
const emailOwnerA = `t028a-own-${runId}@example.com`;
const emailMemberA = `t028a-mem-${runId}@example.com`;
const emailOwnerB = `t028b-own-${runId}@example.com`;
const emailNoConsul = `t028-nocon-${runId}@example.com`;

let cAId: string;
let cBId: string;
let ownerAId: string;
let memberAId: string;
let ownerBId: string;
let noConsulId: string;

function futureDateIso(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function pastDateIso(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  const [{ data: cA }, { data: cB }] = await Promise.all([
    admin.from('consultoras').insert({ name: 'T028A', slug: slugA }).select('id').single(),
    admin.from('consultoras').insert({ name: 'T028B', slug: slugB }).select('id').single(),
  ]);
  cAId = cA!.id;
  cBId = cB!.id;

  const [{ data: uOA }, { data: uMA }, { data: uOB }, { data: uNc }] = await Promise.all([
    admin.auth.admin.createUser({ email: emailOwnerA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailMemberA, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailOwnerB, password, email_confirm: true }),
    admin.auth.admin.createUser({ email: emailNoConsul, password, email_confirm: true }),
  ]);
  ownerAId = uOA.user!.id;
  memberAId = uMA.user!.id;
  ownerBId = uOB.user!.id;
  noConsulId = uNc.user!.id;

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: memberAId, consultora_id: cAId, role: 'member' },
    { user_id: ownerBId, consultora_id: cBId, role: 'owner' },
  ]);

  await Promise.all([
    admin.auth.admin.updateUserById(ownerAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(memberAId, { app_metadata: { consultora_id: cAId } }),
    admin.auth.admin.updateUserById(ownerBId, { app_metadata: { consultora_id: cBId } }),
  ]);
});

afterAll(async () => {
  await Promise.all([
    admin.auth.admin.deleteUser(ownerAId).catch(() => {}),
    admin.auth.admin.deleteUser(memberAId).catch(() => {}),
    admin.auth.admin.deleteUser(ownerBId).catch(() => {}),
    admin.auth.admin.deleteUser(noConsulId).catch(() => {}),
  ]);
});

beforeEach(() => {
  cookieStore.length = 0;
  loggerWarnMock.mockClear();
  loggerErrorMock.mockClear();
  loggerInfoMock.mockClear();
});

const sessionCache = new Map<string, Array<{ name: string; value: string }>>();
async function signInAs(email: string): Promise<void> {
  cookieStore.length = 0;
  const cached = sessionCache.get(email);
  if (cached) {
    for (const c of cached) cookieStore.push({ ...c });
    return;
  }
  const { createClient: createServerClient } = await import('@/shared/supabase/server');
  const sb = await createServerClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  sessionCache.set(
    email,
    cookieStore.map((c) => ({ ...c })),
  );
}

describe('createCalendarEventAction', () => {
  it('1. happy path RGRL: defaults [60,30,7,0] → 4 reminders creados (fecha futura)', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await createCalendarEventAction({
      tipo: 'rgrl_anual',
      titulo: 'Smoke RGRL Acme',
      fecha_vencimiento: futureDateIso(120),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remindersCreated).toBe(4);
    expect(result.remindersSkippedPast).toBe(0);

    const { data: rems } = await admin
      .from('calendar_event_reminders')
      .select('offset_days, status, scheduled_at')
      .eq('event_id', result.eventId)
      .order('offset_days', { ascending: false });
    expect(rems?.map((r) => r.offset_days)).toEqual([60, 30, 7, 0]);
    expect(rems?.every((r) => r.status === 'pending')).toBe(true);
  });

  it('2. happy path EPP: defaults [14,3,0]', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await createCalendarEventAction({
      tipo: 'epp_entrega',
      titulo: 'EPP Juan Perez',
      fecha_vencimiento: futureDateIso(30),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remindersCreated).toBe(3);

    const { data: rems } = await admin
      .from('calendar_event_reminders')
      .select('offset_days')
      .eq('event_id', result.eventId)
      .order('offset_days', { ascending: false });
    expect(rems?.map((r) => r.offset_days)).toEqual([14, 3, 0]);
  });

  it('3. happy path Calibracion: defaults [60,14,0]', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await createCalendarEventAction({
      tipo: 'calibracion',
      titulo: 'Calibracion sonometro',
      fecha_vencimiento: futureDateIso(90),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remindersCreated).toBe(3);

    const { data: rems } = await admin
      .from('calendar_event_reminders')
      .select('offset_days')
      .eq('event_id', result.eventId)
      .order('offset_days', { ascending: false });
    expect(rems?.map((r) => r.offset_days)).toEqual([60, 14, 0]);
  });

  it('4. override reminder_offsets_days → reminders custom', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await createCalendarEventAction({
      tipo: 'rgrl_anual',
      titulo: 'RGRL custom offsets',
      fecha_vencimiento: futureDateIso(90),
      reminder_offsets_days: [45, 14],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remindersCreated).toBe(2);

    const { data: rems } = await admin
      .from('calendar_event_reminders')
      .select('offset_days')
      .eq('event_id', result.eventId)
      .order('offset_days', { ascending: false });
    expect(rems?.map((r) => r.offset_days)).toEqual([45, 14]);
  });

  it('5. skip pasado: vencimiento +5d con defaults [30,7,0] → 1 reminder, 2 skipped + log warn', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await createCalendarEventAction({
      tipo: 'capacitacion',
      titulo: 'Capacitacion proxima',
      fecha_vencimiento: futureDateIso(5),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remindersCreated).toBe(1); // solo offset 0
    expect(result.remindersSkippedPast).toBe(2); // 30 y 7 cayeron en pasado

    expect(
      loggerWarnMock.mock.calls.some(
        (call) => typeof call[1] === 'string' && call[1] === 'reminders_skipped_past_date',
      ),
    ).toBe(true);
  });

  it('6. member non-creator OK: cualquier member crea (no es gate creator-only)', async () => {
    await signInAs(emailMemberA);
    const { createCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await createCalendarEventAction({
      tipo: 'custom',
      titulo: 'Member crea',
      fecha_vencimiento: futureDateIso(20),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data: ev } = await admin
      .from('calendar_events')
      .select('created_by')
      .eq('id', result.eventId)
      .single();
    expect(ev?.created_by).toBe(memberAId);
  });

  it('7. INVALID_INPUT: titulo de 2 chars → fieldErrors.titulo', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await createCalendarEventAction({
      tipo: 'custom',
      titulo: 'ab',
      fecha_vencimiento: futureDateIso(7),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
    if (result.code !== 'INVALID_INPUT') return;
    expect(result.fieldErrors.titulo).toBeDefined();
  });

  it('8. UNAUTHENTICATED: sin sesion', async () => {
    cookieStore.length = 0;
    const { createCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await createCalendarEventAction({
      tipo: 'custom',
      titulo: 'Sin sesion',
      fecha_vencimiento: futureDateIso(7),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('9. NO_CONSULTORA: user huerfano', async () => {
    await signInAs(emailNoConsul);
    const { createCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const result = await createCalendarEventAction({
      tipo: 'custom',
      titulo: 'Sin consultora',
      fecha_vencimiento: futureDateIso(7),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NO_CONSULTORA');
  });
});

describe('updateCalendarEventAction', () => {
  it('10. update por creator → ok', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, updateCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'protocolo_anual',
      titulo: 'Original titulo',
      fecha_vencimiento: futureDateIso(60),
    });
    if (!created.ok) throw new Error('precondition failed');

    const result = await updateCalendarEventAction(created.eventId, {
      titulo: 'Titulo actualizado',
    });
    expect(result.ok).toBe(true);

    const { data: ev } = await admin
      .from('calendar_events')
      .select('titulo')
      .eq('id', created.eventId)
      .single();
    expect(ev?.titulo).toBe('Titulo actualizado');
  });

  it('11. update por owner non-creator → ok', async () => {
    // Crear con member.
    await signInAs(emailMemberA);
    const { createCalendarEventAction, updateCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'examen_medico',
      titulo: 'Creado por member',
      fecha_vencimiento: futureDateIso(60),
    });
    if (!created.ok) throw new Error('precondition failed');

    // Owner edita.
    await signInAs(emailOwnerA);
    const result = await updateCalendarEventAction(created.eventId, {
      titulo: 'Editado por owner',
    });
    expect(result.ok).toBe(true);
  });

  it('12. update por member non-creator non-owner → FORBIDDEN', async () => {
    // Crear con ownerA.
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, updateCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'capacitacion',
      titulo: 'Solo owner edita',
      fecha_vencimiento: futureDateIso(60),
    });
    if (!created.ok) throw new Error('precondition failed');

    // Member intenta editar.
    await signInAs(emailMemberA);
    const result = await updateCalendarEventAction(created.eventId, {
      titulo: 'Hijack attempt',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN');
  });

  it('13. update fecha_vencimiento → reminders pending recomputados con nueva fecha', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, updateCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'rgrl_anual',
      titulo: 'Recompute por fecha',
      fecha_vencimiento: futureDateIso(120),
    });
    if (!created.ok) throw new Error('precondition failed');

    const newFecha = futureDateIso(180);
    const result = await updateCalendarEventAction(created.eventId, {
      fecha_vencimiento: newFecha,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remindersRecomputed).toBe(true);

    // Verificar que scheduled_at se recomputaron (offset_days iguales, fecha diff).
    const { data: rems } = await admin
      .from('calendar_event_reminders')
      .select('offset_days, scheduled_at')
      .eq('event_id', created.eventId)
      .eq('status', 'pending')
      .order('offset_days', { ascending: false });

    // Para offset 0, scheduled_at deberia ser newFecha at 12:00 UTC.
    const offsetZero = rems?.find((r) => r.offset_days === 0);
    expect(offsetZero?.scheduled_at).toBe(`${newFecha}T12:00:00+00:00`);
  });

  it('14. update reminder_offsets_days → DELETE pending + INSERT nuevos (sent preservados)', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, updateCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'rgrl_anual',
      titulo: 'Recompute por offsets',
      fecha_vencimiento: futureDateIso(120),
    });
    if (!created.ok) throw new Error('precondition failed');

    // Marcar 1 reminder como sent (simula cron T-031 enviando uno).
    const { data: someRem } = await admin
      .from('calendar_event_reminders')
      .select('id')
      .eq('event_id', created.eventId)
      .eq('offset_days', 60)
      .single();
    await admin
      .from('calendar_event_reminders')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', someRem!.id);

    // Cambiar offsets a [45, 7].
    const result = await updateCalendarEventAction(created.eventId, {
      reminder_offsets_days: [45, 7],
    });
    expect(result.ok).toBe(true);

    const { data: rems } = await admin
      .from('calendar_event_reminders')
      .select('offset_days, status')
      .eq('event_id', created.eventId)
      .order('offset_days', { ascending: false });

    // Sent original (offset 60) preservado + nuevos pending (45, 7).
    const sentRem = rems?.find((r) => r.status === 'sent');
    expect(sentRem?.offset_days).toBe(60);
    const pendings = rems
      ?.filter((r) => r.status === 'pending')
      .map((r) => r.offset_days)
      .sort((a, b) => a - b);
    expect(pendings).toEqual([7, 45]);
  });

  it('15. update cross-tenant → NOT_FOUND', async () => {
    // ownerB intenta editar evento de cA.
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, updateCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'custom',
      titulo: 'cA event',
      fecha_vencimiento: futureDateIso(30),
    });
    if (!created.ok) throw new Error('precondition failed');

    await signInAs(emailOwnerB);
    const result = await updateCalendarEventAction(created.eventId, { titulo: 'cross-tenant' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});

describe('completeCalendarEventAction', () => {
  it('16. complete sin recurrencia → status=completed + reminders pending → skipped + nextEventId null', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, completeCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'capacitacion',
      titulo: 'Complete sin recurrence',
      fecha_vencimiento: futureDateIso(30),
    });
    if (!created.ok) throw new Error('precondition failed');

    const result = await completeCalendarEventAction(created.eventId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextEventId).toBeNull();
    expect(result.remindersSkipped).toBeGreaterThan(0);

    const { data: ev } = await admin
      .from('calendar_events')
      .select('status, completed_at, completed_by')
      .eq('id', created.eventId)
      .single();
    expect(ev?.status).toBe('completed');
    expect(ev?.completed_at).toBeTruthy();
    expect(ev?.completed_by).toBe(ownerAId);

    const { data: rems } = await admin
      .from('calendar_event_reminders')
      .select('status')
      .eq('event_id', created.eventId);
    expect(rems?.every((r) => r.status === 'skipped')).toBe(true);
  });

  it('17. complete con recurrence_months=12 → next event creado con fecha+12m, informe_id=null', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, completeCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');

    // Crear informe fixture vinculado para verificar que NO se copia al next.
    const { data: informe } = await admin
      .from('informes')
      .insert({
        consultora_id: cAId,
        tipo: 'rgrl',
        titulo: 'T028 informe vinculado',
        created_by: ownerAId,
      })
      .select('id')
      .single();

    const created = await createCalendarEventAction({
      tipo: 'rgrl_anual',
      titulo: 'RGRL recurrente',
      fecha_vencimiento: futureDateIso(60),
      recurrence_months: 12,
      informe_id: informe!.id,
    });
    if (!created.ok) throw new Error('precondition failed');

    const result = await completeCalendarEventAction(created.eventId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextEventId).not.toBeNull();
    expect(result.nextRemindersCreated).toBe(4); // RGRL defaults [60,30,7,0]

    const { data: nextEv } = await admin
      .from('calendar_events')
      .select('tipo, titulo, recurrence_months, informe_id, fecha_vencimiento, created_by, status')
      .eq('id', result.nextEventId!)
      .single();
    expect(nextEv?.tipo).toBe('rgrl_anual');
    expect(nextEv?.titulo).toBe('RGRL recurrente');
    expect(nextEv?.recurrence_months).toBe(12);
    expect(nextEv?.informe_id).toBeNull(); // KEY: no se copia
    expect(nextEv?.created_by).toBe(ownerAId);
    expect(nextEv?.status).toBe('pending');
  });

  it('18. complete event ya completado → ALREADY_FINAL', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, completeCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'custom',
      titulo: 'Already final test',
      fecha_vencimiento: futureDateIso(30),
    });
    if (!created.ok) throw new Error('precondition failed');

    const first = await completeCalendarEventAction(created.eventId);
    expect(first.ok).toBe(true);

    const second = await completeCalendarEventAction(created.eventId);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('ALREADY_FINAL');
  });

  it('19. audit_log row escrito con action=updated + status diff', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, completeCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'custom',
      titulo: 'Audit complete test',
      fecha_vencimiento: futureDateIso(30),
    });
    if (!created.ok) throw new Error('precondition failed');

    const result = await completeCalendarEventAction(created.eventId);
    expect(result.ok).toBe(true);

    const { data: logs } = await admin
      .from('audit_log')
      .select('action, before_data, after_data')
      .eq('entity_type', 'calendar_events')
      .eq('entity_id', created.eventId)
      .eq('action', 'updated');
    expect(logs?.length).toBeGreaterThanOrEqual(1);
    const lastLog = logs![logs!.length - 1]!;
    const before = lastLog.before_data as Record<string, unknown>;
    const after = lastLog.after_data as Record<string, unknown>;
    expect(before.status).toBe('pending');
    expect(after.status).toBe('completed');
  });
});

describe('cancelCalendarEventAction', () => {
  it('20. cancel happy path con reason → status=cancelled + metadata.cancel_reason + reminders skipped', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, cancelCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'capacitacion',
      titulo: 'Cancel con reason',
      fecha_vencimiento: futureDateIso(60),
    });
    if (!created.ok) throw new Error('precondition failed');

    const result = await cancelCalendarEventAction(
      created.eventId,
      'Cliente desistio del servicio',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remindersSkipped).toBeGreaterThan(0);

    const { data: ev } = await admin
      .from('calendar_events')
      .select('status, metadata')
      .eq('id', created.eventId)
      .single();
    expect(ev?.status).toBe('cancelled');
    const meta = ev?.metadata as Record<string, unknown>;
    expect(meta.cancel_reason).toBe('Cliente desistio del servicio');
  });

  it('21. cancel sin reason → metadata sin cancel_reason', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, cancelCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'custom',
      titulo: 'Cancel sin reason',
      fecha_vencimiento: futureDateIso(30),
    });
    if (!created.ok) throw new Error('precondition failed');

    const result = await cancelCalendarEventAction(created.eventId);
    expect(result.ok).toBe(true);

    const { data: ev } = await admin
      .from('calendar_events')
      .select('metadata')
      .eq('id', created.eventId)
      .single();
    // metadata se queda como esta (null o lo que tuviera). Sin cancel_reason key.
    if (ev?.metadata !== null) {
      const meta = ev?.metadata as Record<string, unknown>;
      expect(meta.cancel_reason).toBeUndefined();
    }
  });

  it('22. cancel NO crea next event aunque haya recurrence_months (anti-test)', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction, cancelCalendarEventAction } =
      await import('@/app/(app)/calendario/actions');
    const created = await createCalendarEventAction({
      tipo: 'rgrl_anual',
      titulo: 'Cancel con recurrence',
      fecha_vencimiento: futureDateIso(60),
      recurrence_months: 12,
    });
    if (!created.ok) throw new Error('precondition failed');

    const beforeCount = await admin
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('consultora_id', cAId);

    await cancelCalendarEventAction(created.eventId);

    const afterCount = await admin
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('consultora_id', cAId);

    // Mismo count: cancel no crea events nuevos.
    expect(afterCount.count).toBe(beforeCount.count);
  });
});

describe('queries', () => {
  it('23. getUpcomingEvents(7) filtra correctamente por dias y status', async () => {
    await signInAs(emailOwnerA);
    const { createCalendarEventAction } = await import('@/app/(app)/calendario/actions');
    const { getUpcomingEvents } = await import('@/app/(app)/calendario/queries');

    const inOneDay = await createCalendarEventAction({
      tipo: 'custom',
      titulo: 'Upcoming +1d',
      fecha_vencimiento: futureDateIso(1),
    });
    const inFiveDays = await createCalendarEventAction({
      tipo: 'custom',
      titulo: 'Upcoming +5d',
      fecha_vencimiento: futureDateIso(5),
    });
    const inSixtyDays = await createCalendarEventAction({
      tipo: 'custom',
      titulo: 'Upcoming +60d (out of range)',
      fecha_vencimiento: futureDateIso(60),
    });
    if (!inOneDay.ok || !inFiveDays.ok || !inSixtyDays.ok) {
      throw new Error('precondition failed');
    }

    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const upcoming = await getUpcomingEvents(sb, 7);
    const ids = upcoming.map((e) => e.id);
    expect(ids).toContain(inOneDay.eventId);
    expect(ids).toContain(inFiveDays.eventId);
    expect(ids).not.toContain(inSixtyDays.eventId);
  });

  it('24. getOverdueEvents devuelve solo pending vencidos', async () => {
    await signInAs(emailOwnerA);
    const { getOverdueEvents } = await import('@/app/(app)/calendario/queries');

    // Insertar overdue via admin (no via action — el action no permite fechas
    // pasadas en el sentido de business pero el schema sí).
    const { data: overdueEv } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cAId,
        tipo: 'custom',
        titulo: 'Overdue test',
        fecha_vencimiento: pastDateIso(5),
        reminder_offsets_days: [0],
        created_by: ownerAId,
      })
      .select('id')
      .single();

    // Insertar overdue completed (no debe aparecer).
    const { data: overdueCompletedEv } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cAId,
        tipo: 'custom',
        titulo: 'Overdue but completed',
        fecha_vencimiento: pastDateIso(10),
        reminder_offsets_days: [0],
        status: 'completed',
        created_by: ownerAId,
      })
      .select('id')
      .single();

    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();
    const overdue = await getOverdueEvents(sb);
    const ids = overdue.map((e) => e.id);
    expect(ids).toContain(overdueEv!.id);
    expect(ids).not.toContain(overdueCompletedEv!.id);
  });

  it('25. queries respetan RLS cross-tenant (cB no ve eventos de cA)', async () => {
    // Crear evento en cA via admin.
    const { data: evCa } = await admin
      .from('calendar_events')
      .insert({
        consultora_id: cAId,
        tipo: 'custom',
        titulo: 'Cross-tenant query test',
        fecha_vencimiento: futureDateIso(10),
        reminder_offsets_days: [7, 0],
        created_by: ownerAId,
      })
      .select('id')
      .single();

    await signInAs(emailOwnerB);
    const { getCalendarEventById, getUpcomingEvents } =
      await import('@/app/(app)/calendario/queries');
    const { createClient: createServerClient } = await import('@/shared/supabase/server');
    const sb = await createServerClient();

    const single = await getCalendarEventById(sb, evCa!.id);
    expect(single).toBeNull();

    const upcoming = await getUpcomingEvents(sb, 30);
    const ids = upcoming.map((e) => e.id);
    expect(ids).not.toContain(evCa!.id);
  });
});
