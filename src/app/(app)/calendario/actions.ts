'use server';

import type { BillingGateReason } from '@/shared/billing/access';
import type { Database, Json } from '@/shared/supabase/types';
import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireBillingAccess } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import {
  addRecurrenceMonths,
  computeReminderRows,
  computeScheduledAtUtc,
} from '@/shared/calendar/scheduling';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

import { DEFAULT_REMINDER_OFFSETS_BY_TYPE, SYSTEM_GENERATED_EVENT_TIPOS } from './defaults';
import {
  cancelReasonSchema,
  createCalendarEventSchema,
  eventIdSchema,
  updateCalendarEventPatchSchema,
} from './schema';

/**
 * T-028 · Server actions del modulo Calendario.
 *
 * Patron canonico (T-019/T-020/T-024): discriminated union de retorno, NUNCA
 * tira. El cliente patternmatchea sobre `code` para UX. Pasos por cada action:
 *  1. Zod safeParse → INVALID_INPUT con fieldErrors si falla.
 *  2. getUser → UNAUTHENTICATED.
 *  3. getCurrentConsultora → NO_CONSULTORA.
 *  4. (cuando aplica) SELECT del recurso vía cliente authed (RLS filtra) →
 *     NOT_FOUND si null.
 *  5. Permission gate defensivo (creator OR owner) cuando aplica.
 *  6. Operacion DB. Audit trigger SQL captura diff automaticamente.
 *  7. revalidatePath del happy path.
 *
 * Reminders se crean via service-role: T-027 deliberadamente cerro INSERT/
 * UPDATE/DELETE para authenticated en `calendar_event_reminders` (decision
 * T-027 L268-271). Si abrieramos a authenticated, un user podria programar
 * scheduled_at arbitrario o duplicar reminders.
 */

const FORBIDDEN_MESSAGE = 'Solo el creador del vencimiento o un owner pueden modificarlo.';
const RLS_VIOLATION_CODE = '42501';

function buildInvalidInput(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): { fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map((p) => String(p)).join('.') || '_';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { fieldErrors };
}

// ---------------------------------------------------------------------------
// createCalendarEventAction
// ---------------------------------------------------------------------------

export type CreateEventResult =
  | {
      ok: true;
      eventId: string;
      remindersCreated: number;
      remindersSkippedPast: number;
    }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'FORBIDDEN' | 'INTERNAL_ERROR';
      message: string;
    }
  | {
      ok: false;
      code: 'BILLING_GATED';
      reason: BillingGateReason;
      message: string;
    };

export async function createCalendarEventAction(input: unknown): Promise<CreateEventResult> {
  const parsed = createCalendarEventSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      ...buildInvalidInput(parsed.error.issues),
      message: 'Revisá los campos del formulario.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  // T-073 · Trial gate. Si el silent path de publishInformeAction (T-036) llama
  // a este action con trial vencido, queda gated — el publish primario igual
  // pasa (UPDATE no se bloquea) y el silent path se logea como fallido.
  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    logger.info(
      { userId: user.id, consultoraId: consultora.id, reason: billing.reason },
      'createCalendarEventAction: billing gated',
    );
    return {
      ok: false,
      code: 'BILLING_GATED',
      reason: billing.reason,
      message: getGateMessage(billing.reason),
    };
  }

  const offsets = parsed.data.reminder_offsets_days ?? [
    ...DEFAULT_REMINDER_OFFSETS_BY_TYPE[parsed.data.tipo],
  ];

  const { data: event, error: eventError } = await supabase
    .from('calendar_events')
    .insert({
      consultora_id: consultora.id,
      tipo: parsed.data.tipo,
      titulo: parsed.data.titulo,
      descripcion: parsed.data.descripcion ?? null,
      fecha_vencimiento: parsed.data.fecha_vencimiento,
      informe_id: parsed.data.informe_id ?? null,
      recurrence_months: parsed.data.recurrence_months ?? null,
      metadata: (parsed.data.metadata ?? null) as Json | null,
      reminder_offsets_days: [...offsets],
      created_by: user.id,
    })
    .select('id')
    .single();

  if (eventError || !event) {
    // RLS rejection (cross-tenant attempt or created_by spoof): code 42501.
    if (eventError?.code === RLS_VIOLATION_CODE) {
      logger.warn(
        { userId: user.id, consultoraId: consultora.id, code: 'FORBIDDEN' },
        'createCalendarEventAction: RLS rejected insert',
      );
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'No tenés permiso para crear eventos en esta consultora.',
      };
    }
    logger.error(
      { err: eventError, userId: user.id, consultoraId: consultora.id, tipo: parsed.data.tipo },
      'createCalendarEventAction: insert event failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Error creando el vencimiento.',
    };
  }

  const { rows: reminderRows, skippedPast } = computeReminderRows({
    eventId: event.id,
    consultoraId: consultora.id,
    fechaVencimientoIso: parsed.data.fecha_vencimiento,
    offsetDays: offsets,
    now: new Date(),
  });

  let remindersCreated = 0;
  if (reminderRows.length > 0) {
    const admin = createServiceRoleClient();
    const { data: insertedReminders, error: remindersError } = await admin
      .from('calendar_event_reminders')
      .insert(reminderRows)
      .select('id');

    if (remindersError) {
      // Rollback manual del event (no hay transactions cross-client en
      // Supabase). Patron T-024: si la op secundaria falla, deshacemos la
      // primaria para no dejar estado parcial.
      await admin
        .from('calendar_events')
        .delete()
        .eq('id', event.id)
        .then(() => undefined);
      logger.error(
        { err: remindersError, eventId: event.id, consultoraId: consultora.id },
        'createCalendarEventAction: reminders insert failed, rolled back event',
      );
      return {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'Error creando los recordatorios. Volvé a intentar.',
      };
    }
    remindersCreated = insertedReminders?.length ?? 0;
  }

  if (skippedPast > 0) {
    logger.warn(
      { eventId: event.id, consultoraId: consultora.id, skippedPast, offsets },
      'reminders_skipped_past_date',
    );
  }

  revalidatePath('/calendario');
  revalidatePath('/dashboard');

  logger.info(
    {
      eventId: event.id,
      consultoraId: consultora.id,
      userId: user.id,
      tipo: parsed.data.tipo,
      remindersCreated,
      remindersSkippedPast: skippedPast,
    },
    'calendar_event_created',
  );

  return {
    ok: true,
    eventId: event.id,
    remindersCreated,
    remindersSkippedPast: skippedPast,
  };
}

// ---------------------------------------------------------------------------
// updateCalendarEventAction
// ---------------------------------------------------------------------------

export type UpdateEventResult =
  | {
      ok: true;
      eventId: string;
      remindersRecomputed: boolean;
      remindersCreated: number;
      remindersSkippedPast: number;
    }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL_ERROR';
      message: string;
    };

export async function updateCalendarEventAction(
  eventId: string,
  patch: unknown,
): Promise<UpdateEventResult> {
  const idCheck = eventIdSchema.safeParse(eventId);
  const patchCheck = updateCalendarEventPatchSchema.safeParse(patch);
  if (!idCheck.success || !patchCheck.success) {
    const issues = [
      ...(idCheck.success ? [] : idCheck.error.issues.map((i) => ({ ...i, path: ['eventId'] }))),
      ...(patchCheck.success ? [] : patchCheck.error.issues),
    ];
    return {
      ok: false,
      code: 'INVALID_INPUT',
      ...buildInvalidInput(issues),
      message: 'Datos inválidos.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' };

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  const { data: event } = await supabase
    .from('calendar_events')
    .select('id, created_by, consultora_id, fecha_vencimiento, status, tipo')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) {
    return { ok: false, code: 'NOT_FOUND', message: 'Vencimiento no encontrado.' };
  }

  const isCreator = event.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE };
  }

  const patchData = patchCheck.data;

  // T-133 · Los eventos system-generated (gen_*) usan metadata como linkage al
  // dominio (semáforo / contexto EPP) y nunca llevan recurrencia: un patch de
  // esos campos rompería la derivación. titulo/descripcion/fecha/reminders
  // siguen editables (la fecha propaga al origen vía trigger T-118 — feature).
  // `recurrence_months: null` pasa: EventForm edit lo manda incondicionalmente
  // (checkbox apagado) y des-setear recurrencia es remediación, no riesgo. El
  // trigger calendar_events_guard_system_rows (DB) es el backstop de este guard.
  if ((SYSTEM_GENERATED_EVENT_TIPOS as readonly string[]).includes(event.tipo)) {
    const fieldErrors: Record<string, string[]> = {};
    if (patchData.metadata !== undefined) {
      fieldErrors.metadata = ['No editable en eventos generados por el sistema.'];
    }
    if (patchData.recurrence_months !== undefined && patchData.recurrence_months !== null) {
      fieldErrors.recurrence_months = ['Los eventos del sistema no admiten recurrencia.'];
    }
    if (Object.keys(fieldErrors).length > 0) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        fieldErrors,
        message: 'Este vencimiento lo genera el sistema: su metadata y recurrencia no se editan.',
      };
    }
  }
  const updatePayload: Database['public']['Tables']['calendar_events']['Update'] = {};
  if (patchData.titulo !== undefined) updatePayload.titulo = patchData.titulo;
  if (patchData.descripcion !== undefined) updatePayload.descripcion = patchData.descripcion;
  if (patchData.fecha_vencimiento !== undefined) {
    updatePayload.fecha_vencimiento = patchData.fecha_vencimiento;
  }
  if (patchData.recurrence_months !== undefined) {
    updatePayload.recurrence_months = patchData.recurrence_months;
  }
  if (patchData.metadata !== undefined) {
    updatePayload.metadata = patchData.metadata as Json | null;
  }
  if (patchData.reminder_offsets_days !== undefined) {
    updatePayload.reminder_offsets_days = [...patchData.reminder_offsets_days];
  }

  const { data, error } = await supabase
    .from('calendar_events')
    .update(updatePayload)
    .eq('id', eventId)
    .select('id');

  if (error) {
    logger.error(
      { err: error, eventId, userId: user.id, consultoraId: consultora.id },
      'updateCalendarEventAction: update failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error actualizando el vencimiento.' };
  }
  if (!data || data.length === 0) {
    // RLS WITH CHECK rechazo (race entre el SELECT defensivo y el UPDATE).
    return { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE };
  }

  // Recalculo de reminders (3 casos):
  //  A) patch trae offsets → DELETE pending + INSERT nuevos.
  //  B) patch trae fecha (sin offsets) → recompute scheduled_at por reminder
  //     pending, UPDATE inline. Preserva id + offset_days (UNIQUE intacta).
  //  C) ni A ni B → no tocar.
  let remindersRecomputed = false;
  let remindersCreated = 0;
  let remindersSkippedPast = 0;

  const newOffsets = patchData.reminder_offsets_days;
  const newFecha = patchData.fecha_vencimiento ?? event.fecha_vencimiento;
  const fechaCambio = patchData.fecha_vencimiento !== undefined;
  const offsetsCambio = newOffsets !== undefined;

  if (offsetsCambio || fechaCambio) {
    remindersRecomputed = true;
    const admin = createServiceRoleClient();
    const now = new Date();

    if (offsetsCambio) {
      // Caso A: DELETE pending, INSERT recomputed.
      const { error: delError } = await admin
        .from('calendar_event_reminders')
        .delete()
        .eq('event_id', eventId)
        .eq('status', 'pending');
      if (delError) {
        logger.error(
          { err: delError, eventId, consultoraId: consultora.id },
          'updateCalendarEventAction: delete pending reminders failed',
        );
        return {
          ok: false,
          code: 'INTERNAL_ERROR',
          message: 'Error reprogramando los recordatorios.',
        };
      }

      const { rows: newRows, skippedPast } = computeReminderRows({
        eventId,
        consultoraId: consultora.id,
        fechaVencimientoIso: newFecha,
        offsetDays: newOffsets,
        now,
      });
      remindersSkippedPast = skippedPast;
      if (newRows.length > 0) {
        const { data: inserted, error: insError } = await admin
          .from('calendar_event_reminders')
          .insert(newRows)
          .select('id');
        if (insError) {
          logger.error(
            { err: insError, eventId, consultoraId: consultora.id },
            'updateCalendarEventAction: insert recomputed reminders failed',
          );
          return {
            ok: false,
            code: 'INTERNAL_ERROR',
            message: 'Error reprogramando los recordatorios.',
          };
        }
        remindersCreated = inserted?.length ?? 0;
      }
    } else {
      // Caso B: solo fecha cambio. Recompute scheduled_at por reminder pending.
      const { data: pendings } = await admin
        .from('calendar_event_reminders')
        .select('id, offset_days')
        .eq('event_id', eventId)
        .eq('status', 'pending');

      for (const r of pendings ?? []) {
        const newScheduledAt = computeScheduledAtUtc(newFecha, r.offset_days);
        const isPast = newScheduledAt.getTime() < now.getTime();
        const { error: upErr } = await admin
          .from('calendar_event_reminders')
          .update({
            scheduled_at: newScheduledAt.toISOString(),
            status: isPast ? 'skipped' : 'pending',
          })
          .eq('id', r.id);
        if (upErr) {
          logger.error(
            { err: upErr, eventId, reminderId: r.id, consultoraId: consultora.id },
            'updateCalendarEventAction: update reminder scheduled_at failed',
          );
          return {
            ok: false,
            code: 'INTERNAL_ERROR',
            message: 'Error reprogramando los recordatorios.',
          };
        }
        if (isPast) remindersSkippedPast += 1;
      }
    }
  }

  revalidatePath('/calendario');
  revalidatePath(`/calendario/${eventId}`);
  revalidatePath('/dashboard');

  logger.info(
    {
      eventId,
      consultoraId: consultora.id,
      userId: user.id,
      remindersRecomputed,
      remindersCreated,
      remindersSkippedPast,
    },
    'calendar_event_updated',
  );

  return {
    ok: true,
    eventId,
    remindersRecomputed,
    remindersCreated,
    remindersSkippedPast,
  };
}

// ---------------------------------------------------------------------------
// completeCalendarEventAction
// ---------------------------------------------------------------------------

export type CompleteEventResult =
  | {
      ok: true;
      eventId: string;
      nextEventId: string | null;
      nextRemindersCreated: number;
      nextRemindersSkippedPast: number;
    }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'NOT_FOUND'
        | 'FORBIDDEN'
        | 'ALREADY_FINAL'
        | 'INTERNAL_ERROR';
      message: string;
    };

export async function completeCalendarEventAction(eventId: string): Promise<CompleteEventResult> {
  const idCheck = eventIdSchema.safeParse(eventId);
  if (!idCheck.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      ...buildInvalidInput(idCheck.error.issues.map((i) => ({ ...i, path: ['eventId'] }))),
      message: 'UUID inválido.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' };

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  const { data: event } = await supabase
    .from('calendar_events')
    .select(
      'id, created_by, consultora_id, status, tipo, titulo, descripcion, fecha_vencimiento, recurrence_months, reminder_offsets_days, metadata',
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return { ok: false, code: 'NOT_FOUND', message: 'Vencimiento no encontrado.' };

  if (event.status !== 'pending') {
    return {
      ok: false,
      code: 'ALREADY_FINAL',
      message: `El vencimiento ya está ${event.status === 'completed' ? 'completado' : 'cancelado'}.`,
    };
  }

  const isCreator = event.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE };
  }

  const { data: completed, error: upError } = await supabase
    .from('calendar_events')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: user.id,
    })
    .eq('id', eventId)
    .select('id');

  if (upError) {
    logger.error(
      { err: upError, eventId, userId: user.id, consultoraId: consultora.id },
      'completeCalendarEventAction: update failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error completando el vencimiento.' };
  }
  if (!completed || completed.length === 0) {
    return { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE };
  }

  // Skip de reminders pending: lo hace el trigger T-123 (skip_reminders_on_event_final)
  // a nivel DB cuando el UPDATE de arriba pasa status a 'completed' (fuente estructural,
  // cubre tambien caminos SQL/service-role directos). `admin` se reusa abajo para
  // insertar los reminders del evento de recurrencia.
  const admin = createServiceRoleClient();

  // Auto-recurrencia (Opcion A): si recurrence_months no es null, crear el
  // siguiente event con fecha + N meses.
  let nextEventId: string | null = null;
  let nextRemindersCreated = 0;
  let nextRemindersSkippedPast = 0;

  if (event.recurrence_months !== null) {
    const nextFecha = addRecurrenceMonths(event.fecha_vencimiento, event.recurrence_months);

    // informe_id = null en el next event (decision plan): el informe original
    // representa el doc del periodo actual, no el siguiente. DA-05 modal
    // post-firma re-vinculara al firmar el informe N+1.
    //
    // T-036: parent_event_id = event.id liga el next al original (chain de
    // recurrencia). Permite a EventViewPanel mostrar "Auto-creado por
    // recurrencia desde <link>" en lugar de la heuristica no confiable.
    const { data: nextEvent, error: nextErr } = await supabase
      .from('calendar_events')
      .insert({
        consultora_id: consultora.id,
        tipo: event.tipo,
        titulo: event.titulo,
        descripcion: event.descripcion,
        fecha_vencimiento: nextFecha,
        informe_id: null,
        parent_event_id: event.id,
        recurrence_months: event.recurrence_months,
        metadata: event.metadata,
        reminder_offsets_days: event.reminder_offsets_days,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (nextErr || !nextEvent) {
      // NO revertimos el complete del evento original — el user vino a marcar
      // "lo hice", no a "creá el siguiente". Loggeamos a Sentry para que sea
      // recreable manualmente como follow-up admin.
      logger.error(
        {
          err: nextErr,
          originalEventId: eventId,
          consultoraId: consultora.id,
          recurrence_months: event.recurrence_months,
          fechaVencimiento: event.fecha_vencimiento,
        },
        'auto_recurrence_failed',
      );
    } else {
      nextEventId = nextEvent.id;

      const { rows: nextRows, skippedPast: nextSkipped } = computeReminderRows({
        eventId: nextEvent.id,
        consultoraId: consultora.id,
        fechaVencimientoIso: nextFecha,
        offsetDays: event.reminder_offsets_days,
        now: new Date(),
      });
      nextRemindersSkippedPast = nextSkipped;

      if (nextRows.length > 0) {
        const { data: insertedNext, error: insNextErr } = await admin
          .from('calendar_event_reminders')
          .insert(nextRows)
          .select('id');
        if (insNextErr) {
          logger.error(
            {
              err: insNextErr,
              originalEventId: eventId,
              nextEventId: nextEvent.id,
              consultoraId: consultora.id,
            },
            'auto_recurrence_reminders_failed',
          );
        } else {
          nextRemindersCreated = insertedNext?.length ?? 0;
        }
      }
    }
  }

  revalidatePath('/calendario');
  revalidatePath(`/calendario/${eventId}`);
  revalidatePath('/dashboard');
  if (nextEventId) revalidatePath(`/calendario/${nextEventId}`);

  logger.info(
    {
      eventId,
      consultoraId: consultora.id,
      userId: user.id,
      nextEventId,
      nextRemindersCreated,
      nextRemindersSkippedPast,
    },
    'calendar_event_completed',
  );

  return {
    ok: true,
    eventId,
    nextEventId,
    nextRemindersCreated,
    nextRemindersSkippedPast,
  };
}

// ---------------------------------------------------------------------------
// cancelCalendarEventAction
// ---------------------------------------------------------------------------

export type CancelEventResult =
  | { ok: true; eventId: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'NOT_FOUND'
        | 'FORBIDDEN'
        | 'ALREADY_FINAL'
        | 'INTERNAL_ERROR';
      message: string;
    };

export async function cancelCalendarEventAction(
  eventId: string,
  reason?: string,
): Promise<CancelEventResult> {
  const idCheck = eventIdSchema.safeParse(eventId);
  const reasonCheck = cancelReasonSchema.safeParse(reason);
  if (!idCheck.success || !reasonCheck.success) {
    const issues = [
      ...(idCheck.success ? [] : idCheck.error.issues.map((i) => ({ ...i, path: ['eventId'] }))),
      ...(reasonCheck.success
        ? []
        : reasonCheck.error.issues.map((i) => ({ ...i, path: ['reason'] }))),
    ];
    return {
      ok: false,
      code: 'INVALID_INPUT',
      ...buildInvalidInput(issues),
      message: 'Datos inválidos.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' };

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  const { data: event } = await supabase
    .from('calendar_events')
    .select('id, created_by, status, metadata')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return { ok: false, code: 'NOT_FOUND', message: 'Vencimiento no encontrado.' };

  if (event.status !== 'pending') {
    return {
      ok: false,
      code: 'ALREADY_FINAL',
      message: `El vencimiento ya está ${event.status === 'completed' ? 'completado' : 'cancelado'}.`,
    };
  }

  const isCreator = event.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE };
  }

  const trimmedReason = reasonCheck.data;
  const existingMetadata =
    event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, Json>)
      : null;
  const newMetadata: Json | null = trimmedReason
    ? { ...(existingMetadata ?? {}), cancel_reason: trimmedReason }
    : event.metadata;

  const { data: cancelled, error: upError } = await supabase
    .from('calendar_events')
    .update({ status: 'cancelled', metadata: newMetadata })
    .eq('id', eventId)
    .select('id');

  if (upError) {
    logger.error(
      { err: upError, eventId, userId: user.id, consultoraId: consultora.id },
      'cancelCalendarEventAction: update failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error cancelando el vencimiento.' };
  }
  if (!cancelled || cancelled.length === 0) {
    return { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE };
  }

  // Skip de reminders pending: lo hace el trigger T-123 a nivel DB cuando el UPDATE
  // de arriba pasa status a 'cancelled' (no spam de un vencimiento ya resuelto).
  revalidatePath('/calendario');
  revalidatePath(`/calendario/${eventId}`);
  revalidatePath('/dashboard');

  logger.info(
    {
      eventId,
      consultoraId: consultora.id,
      userId: user.id,
      hasReason: trimmedReason !== undefined,
    },
    'calendar_event_cancelled',
  );

  return { ok: true, eventId };
}
