'use server';

import type { BillingGateReason } from '@/shared/billing/access';
import type { Json } from '@/shared/supabase/types';
import type { InformeTipo } from './schema';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createCalendarEventAction } from '@/app/(app)/calendario/actions';
import { DEFAULT_REMINDER_OFFSETS_BY_TYPE } from '@/app/(app)/calendario/defaults';
import { getEventsByInformeId } from '@/app/(app)/calendario/queries';
import { markOnboardingCompletedIfPending } from '@/app/(app)/onboarding/mark-completed';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireBillingAccess } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { addRecurrenceMonths } from '@/shared/calendar/scheduling';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import {
  buildDefaultEventoTitulo,
  mapInformeTipoToEventoConfig,
} from '@/shared/templates/informe-to-event';
import { getServerTemplate } from '@/shared/templates/registry/server';

import { getInformeById } from './queries';
import { createInformeSchema } from './schema';

const informeIdSchema = z.string().uuid({ message: 'UUID inválido.' });

/**
 * T-019 · Server actions del modulo Informes.
 * T-022 · Generaliza la persistencia de metadata via TEMPLATE_SERVER_REGISTRY.
 *
 * Mismo patron que login/signup (T-012/T-013): discriminated union de retorno,
 * NUNCA tira. El cliente patternmatchea sobre `code` para UX.
 */

export type CreateInformeResult =
  | {
      ok: true;
      redirectTo: string;
      informeId: string;
      /** T-021/T-022: true si la metadata estructurada se persistio junto con el informe. */
      metadataPersisted: boolean;
    }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'INTERNAL_ERROR';
      message: string;
    }
  | {
      ok: false;
      code: 'BILLING_GATED';
      reason: BillingGateReason;
      message: string;
    };

/**
 * Crea un informe en la consultora del user logueado.
 *
 * Pasos:
 * 1. Zod safeParse. INVALID_INPUT con fieldErrors si falla (RHF muestra inline).
 * 2. getUser → UNAUTHENTICATED si null. El layout `(app)` ya guardea esto,
 *    pero defensa en profundidad: una action es un endpoint POST publico.
 * 3. getCurrentConsultora → NO_CONSULTORA si null (user huerfano).
 * 4. INSERT con created_by=auth.uid(). RLS WITH CHECK valida member + ownership.
 * 5. (T-022) Si vino metadata y el tipo tiene template registrado, parsearla
 *    contra el schema del registry e INSERT a `informe_metadata`. Fallback no
 *    bloqueante: si Zod o RLS race fallan, el informe queda creado sin
 *    metadata y el user la completa en /editar.
 * 6. revalidatePath de la lista.
 */
export async function createInformeAction(input: unknown): Promise<CreateInformeResult> {
  const parsed = createInformeSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Iniciá sesión para crear un informe.',
    };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    logger.warn({ userId: user.id }, 'createInformeAction: user sin consultora');
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  // T-073 · Trial gate.
  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    logger.info(
      { userId: user.id, consultoraId: consultora.id, reason: billing.reason },
      'createInformeAction: billing gated',
    );
    return {
      ok: false,
      code: 'BILLING_GATED',
      reason: billing.reason,
      message: getGateMessage(billing.reason),
    };
  }

  // T-050 · Cross-tenant defense.
  // El FK `informes.cliente_id REFERENCES clientes(id)` valida que la row exista
  // pero NO respeta RLS — un user podría pasar un cliente_id de OTRO tenant y
  // el INSERT pasaría (data leak: link cross-tenant + información de existencia).
  // Defensa: SELECT RLS-aware sobre clientes. Si la query devuelve null bajo el
  // JWT del user actual → el cliente no existe o es de otro tenant.
  if (parsed.data.cliente_id) {
    const { data: cli } = await supabase
      .from('clientes')
      .select('id')
      .eq('id', parsed.data.cliente_id)
      .maybeSingle();
    if (!cli) {
      logger.warn(
        { userId: user.id, consultoraId: consultora.id, clienteId: parsed.data.cliente_id },
        'createInformeAction: cliente_id no visible bajo RLS — posible cross-tenant',
      );
      return {
        ok: false,
        code: 'INVALID_INPUT',
        fieldErrors: {
          cliente_id: ['Cliente no encontrado o no pertenece a tu consultora.'],
        },
        message: 'Revisá la selección de cliente.',
      };
    }
  }

  const { data, error } = await supabase
    .from('informes')
    .insert({
      consultora_id: consultora.id,
      tipo: parsed.data.tipo,
      titulo: parsed.data.titulo,
      created_by: user.id,
      cliente_id: parsed.data.cliente_id ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id },
      'createInformeAction: insert fallo',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error creando el informe. Reintentá en unos minutos.',
    };
  }

  // T-022 · Generalizacion de metadata via registry. Aplica a los 5 tipos.
  // No bloqueante: si Zod o RLS race fallan, el informe queda creado sin
  // metadata y el user la completa en /editar.
  let metadataPersisted = false;
  const tipoEntry = getServerTemplate(parsed.data.tipo);
  if (tipoEntry && parsed.data.metadata !== undefined) {
    const parsedMeta = tipoEntry.schema.safeParse(parsed.data.metadata);
    if (!parsedMeta.success) {
      logger.warn(
        {
          informeId: data.id,
          tipo: parsed.data.tipo,
          userId: user.id,
          consultoraId: consultora.id,
          issueCount: parsedMeta.error.issues.length,
        },
        'createInformeAction: metadata invalida, informe creado sin datos',
      );
    } else {
      const cleaned = tipoEntry.normalize(parsedMeta.data);
      const { error: metaErr } = await supabase
        .from('informe_metadata')
        // Cast a Json: el normalize() retorna un objeto plano serializable por
        // construccion (todos los `<Tipo>Metadata` lo son), pero TS no lo infiere.
        .insert({ informe_id: data.id, data: cleaned as Json });

      if (metaErr) {
        logger.warn(
          {
            err: metaErr,
            informeId: data.id,
            tipo: parsed.data.tipo,
            userId: user.id,
            consultoraId: consultora.id,
          },
          'createInformeAction: metadata insert fallo, informe creado sin datos',
        );
      } else {
        metadataPersisted = true;
      }
    }
  }

  // T-142 · FU1 · Onboarding real: marcar al crear el primer informe. Best-effort
  // e idempotente; no afecta el return de la creación.
  await markOnboardingCompletedIfPending(consultora.id);

  revalidatePath('/informes');
  logger.info(
    {
      informeId: data.id,
      userId: user.id,
      consultoraId: consultora.id,
      tipo: parsed.data.tipo,
      metadataPersisted,
    },
    'informe_created',
  );

  // Si vino metadata y el tipo tiene template, redirect a /editar (con datos
  // pre-poblados o form vacio si fallo). Si no, redirect a la vista del informe.
  const wantsEditor = tipoEntry !== null && parsed.data.metadata !== undefined;
  const redirectTo = wantsEditor ? `/informes/${data.id}/editar` : `/informes/${data.id}`;

  return {
    ok: true,
    redirectTo,
    informeId: data.id,
    metadataPersisted,
  };
}

// ---------------------------------------------------------------------------
// publishInformeAction (T-036)
// ---------------------------------------------------------------------------

export type PublishInformeResult =
  | {
      ok: true;
      informeId: string;
      /**
       * UUID del calendar_event auto-creado por el silent path
       * (consultora.auto_create_event_on_sign = true + tipo recurrente).
       * null en cualquiera de estos casos:
       *  - Toggle OFF (modal path): el client decide abrir el modal post-OK.
       *  - Tipo no recurrente (accidente / otros): mapping devuelve null.
       *  - Ya hay evento vinculado al informe: no duplica.
       *  - Silent path intentado pero fallo en createCalendarEventAction:
       *    el publish primario igual es ok, el error queda en Sentry.
       *  - Idempotency: informe ya estaba `published`.
       */
      autoCreatedEventId: string | null;
    }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'NOT_FOUND'
        | 'FORBIDDEN'
        | 'EMPTY_CONTENT'
        | 'INTERNAL_ERROR';
      message: string;
    };

/**
 * T-036 · Publica un informe (draft -> published).
 *
 * DA-05 opt-in a Opcion A: si la consultora tiene
 * `auto_create_event_on_sign = true` y el tipo es recurrente (rgrl /
 * relevamiento / capacitacion), crea silently el calendar_event en `today + 12m`.
 * Si el toggle es false, el client decide abrir el modal post-OK con prepop.
 *
 * Permission gate: creator OR owner (mismo patron que update/complete del modulo
 * Calendario T-028).
 *
 * Validacion pre-publish: contenido no vacio. EMPTY_CONTENT si falla.
 *
 * Idempotency: si ya esta `published` retorna ok sin re-disparar silent path.
 *
 * Audit: trigger `audit_informes()` (T-019 + T-020) captura el change de status
 * automaticamente. NO tocar el trigger.
 */
export async function publishInformeAction(informeId: string): Promise<PublishInformeResult> {
  const idCheck = informeIdSchema.safeParse(informeId);
  if (!idCheck.success) {
    const messages = idCheck.error.issues.map((i) => i.message);
    const fieldErrors: Record<string, string[]> = { informeId: messages };
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'UUID inválido.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Iniciá sesión para publicar un informe.',
    };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  const informe = await getInformeById(supabase, idCheck.data);
  if (!informe) {
    return { ok: false, code: 'NOT_FOUND', message: 'Informe no encontrado.' };
  }

  // Permission gate: creator OR owner. Defensa antes del UPDATE.
  const isCreator = informe.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Solo el creador del informe o un owner pueden publicarlo.',
    };
  }

  // Idempotency: si ya esta published, retornar ok sin re-disparar silent path.
  if (informe.status === 'published') {
    return { ok: true, informeId: informe.id, autoCreatedEventId: null };
  }

  // T-141 Fase C · Promover el borrador de autosave: el publicado DEBE ser la
  // última versión editada, no el contenido canónico (que puede estar atrás del
  // autosave). Si hay `contenido_borrador`, esa es la verdad. (El cliente, además,
  // hace flush+draft-save antes de publicar → el tail no autoguardado también
  // entra acá.)
  const effectiveContent = informe.contenido_borrador ?? informe.contenido;

  // Validacion pre-publish: contenido NO vacio. EMPTY_CONTENT si falla.
  if (!effectiveContent || effectiveContent.trim().length === 0) {
    return {
      ok: false,
      code: 'EMPTY_CONTENT',
      message: 'Generá el contenido del informe antes de publicar.',
    };
  }

  // Si hay borrador, la UPDATE promueve (contenido = borrador) y lo limpia, en
  // la misma sentencia que el cambio de status → auditado como un solo publish.
  const updatePayload =
    informe.contenido_borrador != null
      ? { status: 'published' as const, contenido: effectiveContent, contenido_borrador: null }
      : { status: 'published' as const };

  const { error: updError } = await supabase
    .from('informes')
    .update(updatePayload)
    .eq('id', informe.id);

  if (updError) {
    logger.error(
      { err: updError, informeId: informe.id, userId: user.id, consultoraId: consultora.id },
      'publishInformeAction: update status failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error publicando el informe.' };
  }

  // ---- Silent path (DA-05 opt-in a Opcion A) -----------------------------
  // Cast: `informe.tipo` viene como `string` del Row type generado de Supabase,
  // pero el CHECK constraint SQL + el seed de INSERT (createInformeAction L93)
  // garantizan que es uno de los 5 valores de INFORME_TIPOS. Helpers y registry
  // esperan InformeTipo narrowed.
  const tipo = informe.tipo as InformeTipo;
  let autoCreatedEventId: string | null = null;
  if (consultora.autoCreateEventOnSign) {
    const config = mapInformeTipoToEventoConfig(tipo);
    if (config) {
      // No duplicar si ya hay evento vinculado a este informe.
      const existing = await getEventsByInformeId(supabase, informe.id);
      if (existing.length === 0) {
        // Lookup razon_social del informe_metadata (si existe). Fallback al titulo.
        const tpl = getServerTemplate(tipo);
        let razonSocial: string | null = null;
        if (tpl) {
          const { data: metaRow } = await supabase
            .from('informe_metadata')
            .select('data')
            .eq('informe_id', informe.id)
            .maybeSingle();
          const meta = metaRow?.data;
          if (
            meta &&
            typeof meta === 'object' &&
            !Array.isArray(meta) &&
            'razon_social' in meta &&
            typeof (meta as { razon_social: unknown }).razon_social === 'string'
          ) {
            razonSocial = (meta as { razon_social: string }).razon_social;
          }
        }

        const titulo = buildDefaultEventoTitulo({
          informeTitulo: informe.titulo,
          razonSocial,
          eventTipo: config.eventTipo,
        });
        const todayIso = new Date().toISOString().slice(0, 10);
        const fechaVencimiento = addRecurrenceMonths(todayIso, config.recurrenceMonths);

        const createResult = await createCalendarEventAction({
          tipo: config.eventTipo,
          titulo,
          fecha_vencimiento: fechaVencimiento,
          informe_id: informe.id,
          recurrence_months: config.recurrenceMonths,
          reminder_offsets_days: [...DEFAULT_REMINDER_OFFSETS_BY_TYPE[config.eventTipo]],
        });

        if (createResult.ok) {
          autoCreatedEventId = createResult.eventId;
        } else {
          // Best-effort: el publish ya quedo, loggeamos. UX: el user puede crear
          // el evento manual desde /calendario. Mismo patron que auto-recurrencia
          // de complete (T-028 L592-601).
          logger.error(
            {
              code: createResult.code,
              informeId: informe.id,
              userId: user.id,
              consultoraId: consultora.id,
            },
            'publishInformeAction: silent path createCalendarEventAction failed',
          );
        }
      }
    }
  }

  revalidatePath('/informes');
  revalidatePath(`/informes/${informe.id}`);
  revalidatePath(`/informes/${informe.id}/editar`);
  revalidatePath('/calendario');

  logger.info(
    {
      informeId: informe.id,
      userId: user.id,
      consultoraId: consultora.id,
      tipo: informe.tipo,
      autoCreatedEventId,
      autoCreateEventOnSign: consultora.autoCreateEventOnSign,
    },
    'informe_published',
  );

  return { ok: true, informeId: informe.id, autoCreatedEventId };
}

// ---------------------------------------------------------------------------
// unpublishInformeAction (T-036)
// ---------------------------------------------------------------------------

export type UnpublishInformeResult =
  | { ok: true; informeId: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL_ERROR';
      message: string;
    };

/**
 * T-036 · Reversibilidad del publish: published -> draft.
 *
 * Permission gate: creator OR owner.
 * Idempotency: si ya esta `draft` retorna ok sin cambios.
 *
 * NO borra el evento vinculado (si existe) — UX confusa explicar la cascade.
 * El user borra manual desde calendario si quiere.
 *
 * Archived NO se admite como source state (segun el plan: archive es flujo
 * distinto, se maneja desde la lista de informes). Si el informe esta
 * `archived` retorna FORBIDDEN-equivalente como NOT_FOUND a nivel UI (mismo
 * resultado para el user: no puede revertir desde aca).
 */
export async function unpublishInformeAction(informeId: string): Promise<UnpublishInformeResult> {
  const idCheck = informeIdSchema.safeParse(informeId);
  if (!idCheck.success) {
    const messages = idCheck.error.issues.map((i) => i.message);
    const fieldErrors: Record<string, string[]> = { informeId: messages };
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'UUID inválido.',
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

  const informe = await getInformeById(supabase, idCheck.data);
  if (!informe) {
    return { ok: false, code: 'NOT_FOUND', message: 'Informe no encontrado.' };
  }

  const isCreator = informe.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Solo el creador del informe o un owner pueden volverlo a borrador.',
    };
  }

  // Idempotency: si ya esta draft, no hay cambio.
  if (informe.status === 'draft') {
    return { ok: true, informeId: informe.id };
  }

  // Archived no es source state valido aqui.
  if (informe.status !== 'published') {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: `No se puede volver a borrador un informe ${informe.status}.`,
    };
  }

  const { error: updError } = await supabase
    .from('informes')
    .update({ status: 'draft' })
    .eq('id', informe.id);

  if (updError) {
    logger.error(
      { err: updError, informeId: informe.id, userId: user.id, consultoraId: consultora.id },
      'unpublishInformeAction: update status failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error volviendo a borrador.' };
  }

  revalidatePath('/informes');
  revalidatePath(`/informes/${informe.id}`);
  revalidatePath(`/informes/${informe.id}/editar`);

  logger.info(
    {
      informeId: informe.id,
      userId: user.id,
      consultoraId: consultora.id,
      tipo: informe.tipo,
    },
    'informe_unpublished',
  );

  return { ok: true, informeId: informe.id };
}
