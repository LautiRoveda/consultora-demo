'use server';

import { revalidatePath } from 'next/cache';

import { env } from '@/env';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import {
  cancelPreapproval,
  createPreapproval,
  MercadoPagoError,
} from '@/shared/mercadopago/client';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

import { getActiveSubscription } from './queries';
import { suscripcionIdSchema } from './schema';

/**
 * T-071 · Server actions de billing (suscripciones MP).
 *
 * Cero UI acá — las invocan el formulario T-072 (Suscribirme + Cancelar) y
 * los integration tests. El render del estado vive en queries.ts.
 *
 * Discriminated union return + códigos canónicos del patrón clientes/actions.ts.
 */

// ============ Discriminated unions ============

export type CreateSubscriptionResult =
  | { ok: true; initPoint: string; mpSubscriptionId: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'FORBIDDEN_NOT_OWNER'
        | 'NO_EMAIL'
        | 'DUPLICATE_SUBSCRIPTION'
        | 'MP_API_ERROR'
        | 'INTERNAL_ERROR';
      message: string;
    };

export type CancelSubscriptionResult =
  | { ok: true; suscripcionId: string }
  | {
      ok: false;
      code: 'INVALID_INPUT';
      fieldErrors: Record<string, string[]>;
      message: string;
    }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'FORBIDDEN_NOT_OWNER'
        | 'NOT_FOUND'
        | 'NOT_CANCELABLE'
        | 'MP_API_ERROR'
        | 'INTERNAL_ERROR';
      message: string;
    };

// ============ Helpers ============

function addOneMonthIso(fromIso: string): string {
  const d = new Date(fromIso);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

// ============ Actions ============

export async function createSubscriptionAction(): Promise<CreateSubscriptionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return { ok: false, code: 'NO_CONSULTORA', message: 'No tenés una consultora asociada.' };
  }

  // Solo owners pueden iniciar cobros — defensive guard. Members navegan
  // billing read-only.
  if (consultora.role !== 'owner') {
    return {
      ok: false,
      code: 'FORBIDDEN_NOT_OWNER',
      message: 'Solo el owner de la consultora puede suscribirse.',
    };
  }

  if (!user.email) {
    // auth.users.email es nullable solo en flows OAuth-sin-email. Para MP
    // necesitamos email del payer. Si pasa, el user debe completar su email
    // primero — no es flow happy path.
    return {
      ok: false,
      code: 'NO_EMAIL',
      message: 'Tu cuenta no tiene email asociado. Configurá uno antes de suscribirte.',
    };
  }

  // Pre-check: ya hay suscripcion activa (estado distinto a cancelada/expirada).
  // Re-subscripcion desde estos estados terminales se permite (crea fila nueva).
  const existing = await getActiveSubscription(supabase);
  const blockingStates: Array<
    typeof existing extends infer S ? (S extends { estado: infer E } ? E : never) : never
  > = ['trial', 'pendiente_autorizacion', 'activa', 'morosa'];
  if (existing && (blockingStates as readonly string[]).includes(existing.estado)) {
    return {
      ok: false,
      code: 'DUPLICATE_SUBSCRIPTION',
      message:
        'Ya tenés una suscripcion activa o en proceso. Cancelá la anterior antes de crear una nueva.',
    };
  }

  // ARS_PRICE_MONTHLY guarda CENTAVOS (ej "3000000" = ARS 30.000). MP API
  // /preapproval `transaction_amount` espera PESOS con decimales — conversión
  // explícita acá: centavos → pesos (÷ 100).
  const amountPesos = Number(env.ARS_PRICE_MONTHLY) / 100;
  // Buffer 5min anti past-date MP (T-071-FU1): MP rechaza preapproval con
  // start_date exactamente = now() por latencia red al server MP. Mismo
  // valor que el default de createPreapproval para mantener consistencia
  // entre auto_recurring.start_date y suscripciones.periodo_inicio.
  const startDate = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // T-071-FU2: en sandbox MP el seller (Lautaro) no puede ser tambien el
  // buyer del mismo app — auto-purchase blocked. La env var opcional
  // MP_TEST_PAYER_EMAIL inyecta el email del TEST USER buyer creado en MP
  // panel. NUNCA seteada en prod (env.ts emite warn explicito).
  const payerEmail = env.MP_TEST_PAYER_EMAIL ?? user.email;
  if (env.MP_TEST_PAYER_EMAIL) {
    logger.info(
      { userId: user.id, consultoraId: consultora.id, testMode: true, payerEmail },
      'createSubscriptionAction: usando MP_TEST_PAYER_EMAIL como payer (test mode)',
    );
  }

  let preapproval;
  try {
    preapproval = await createPreapproval({
      payerEmail,
      transactionAmountPesos: amountPesos,
      reason: 'ConsultoraDemo Pro · mensual',
      backUrl: `${env.NEXT_PUBLIC_SITE_URL}/settings/billing`,
      startDate,
    });
  } catch (err) {
    if (err instanceof MercadoPagoError) {
      logger.error(
        { err, status: err.status, body: err.body, userId: user.id, consultoraId: consultora.id },
        'createSubscriptionAction: MP createPreapproval falló',
      );
      return {
        ok: false,
        code: 'MP_API_ERROR',
        message: 'No pudimos iniciar el cobro con Mercado Pago. Reintentá en unos minutos.',
      };
    }
    throw err;
  }

  // INSERT fila pendiente_autorizacion. El webhook subscription_preapproval
  // con status=authorized la promueve a 'activa'.
  //
  // RLS de `suscripciones` (T-070) sólo permite SELECT a authenticated —
  // INSERT/UPDATE/DELETE son service_role only ("todo pasa por MP", el
  // server action es el único entry-point legítimo de mutación). El auth
  // check arriba (getCurrentConsultora.role === 'owner' + consultora_id
  // resuelto del JWT claim) garantiza que sólo el owner correcto inserta.
  const admin = createServiceRoleClient();
  const { error: insErr } = await admin.from('suscripciones').insert({
    consultora_id: consultora.id,
    plan_codigo: 'pro_mensual',
    estado: 'pendiente_autorizacion',
    mp_subscription_id: preapproval.id,
    periodo_inicio: startDate,
    periodo_fin: addOneMonthIso(startDate),
  });

  if (insErr) {
    logger.error(
      {
        err: insErr,
        userId: user.id,
        consultoraId: consultora.id,
        mpSubscriptionId: preapproval.id,
      },
      'createSubscriptionAction: INSERT suscripciones falló post-createPreapproval',
    );
    // Estado raro: MP creó el preapproval pero nuestra DB no lo persiste. El
    // webhook va a llegar y no va a matchear `mp_subscription_id`. Loggeamos
    // a Sentry; el user puede reintentar — el INSERT 2x del mismo MP id daría
    // UNIQUE violation, pero como falló el primero el 2do no es duplicate.
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message:
        'Tu suscripcion se creó en Mercado Pago pero no pudimos persistirla. Contactá soporte.',
    };
  }

  revalidatePath('/settings/billing');
  logger.info(
    {
      userId: user.id,
      consultoraId: consultora.id,
      mpSubscriptionId: preapproval.id,
    },
    'createSubscriptionAction: preapproval creado',
  );

  return { ok: true, initPoint: preapproval.init_point, mpSubscriptionId: preapproval.id };
}

export async function cancelSubscriptionAction(
  suscripcionId: unknown,
): Promise<CancelSubscriptionResult> {
  const idParsed = suscripcionIdSchema.safeParse(suscripcionId);
  if (!idParsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of idParsed.error.issues) {
      const key = issue.path.map((p) => String(p)).join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'ID inválido.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return { ok: false, code: 'NO_CONSULTORA', message: 'No tenés una consultora asociada.' };
  }
  if (consultora.role !== 'owner') {
    return {
      ok: false,
      code: 'FORBIDDEN_NOT_OWNER',
      message: 'Solo el owner puede cancelar la suscripcion.',
    };
  }

  // SELECT defensivo — RLS filtra cross-tenant a null.
  const { data: sub } = await supabase
    .from('suscripciones')
    .select('id, mp_subscription_id, estado, cancelar_en')
    .eq('id', idParsed.data)
    .maybeSingle();

  if (!sub) {
    return { ok: false, code: 'NOT_FOUND', message: 'Suscripcion no encontrada.' };
  }

  if (!sub.mp_subscription_id) {
    // Caso raro: fila trial sin preapproval MP todavía. Cancelar a nivel DB
    // simplemente la marca; no hay nada que cancelar en MP.
    return {
      ok: false,
      code: 'NOT_CANCELABLE',
      message: 'Esta suscripcion no tiene preapproval Mercado Pago — nada que cancelar.',
    };
  }

  // Idempotencia: si ya cancelaste antes (cancelar_en != null), no spammeamos
  // a MP. El webhook eventualmente seta cancelada_en.
  if (sub.cancelar_en) {
    return { ok: true, suscripcionId: sub.id };
  }

  try {
    await cancelPreapproval(sub.mp_subscription_id);
  } catch (err) {
    if (err instanceof MercadoPagoError) {
      logger.error(
        {
          err,
          status: err.status,
          body: err.body,
          userId: user.id,
          consultoraId: consultora.id,
          suscripcionId: sub.id,
        },
        'cancelSubscriptionAction: MP cancelPreapproval falló',
      );
      return {
        ok: false,
        code: 'MP_API_ERROR',
        message: 'No pudimos cancelar en Mercado Pago. Reintentá en unos minutos.',
      };
    }
    throw err;
  }

  // RLS service_role only para UPDATE (ver comment en createSubscriptionAction).
  const admin = createServiceRoleClient();
  const { error: updErr } = await admin
    .from('suscripciones')
    .update({ cancelar_en: new Date().toISOString() })
    .eq('id', sub.id);

  if (updErr) {
    logger.error(
      { err: updErr, userId: user.id, suscripcionId: sub.id },
      'cancelSubscriptionAction: UPDATE cancelar_en falló post-cancelPreapproval',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message:
        'Cancelamos en Mercado Pago pero no pudimos actualizar el estado. El webhook lo regulariza.',
    };
  }

  revalidatePath('/settings/billing');
  logger.info(
    { userId: user.id, consultoraId: consultora.id, suscripcionId: sub.id },
    'cancelSubscriptionAction: preapproval cancelado',
  );

  return { ok: true, suscripcionId: sub.id };
}
