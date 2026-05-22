import 'server-only';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  resolveConsultoraOwnerEmail,
  sendPaymentFailed,
  sendSubscriptionCancelled,
} from '@/shared/billing/dunning';
import { getAuthorizedPayment, getPreapproval } from '@/shared/mercadopago/client';
import {
  mapAuthorizedPaymentStatus,
  mapPreapprovalStatus,
  MPWebhookEventSchema,
} from '@/shared/mercadopago/types';
import { verifyWebhookSignature } from '@/shared/mercadopago/verify-signature';
import { logger } from '@/shared/observability/logger';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-071 · Webhook handler de Mercado Pago Subscriptions.
 *
 * MP postea eventos a este endpoint cuando cambia el estado de un preapproval
 * (autorizado, pausado, cancelado) o cuando se genera un cobro recurrente
 * (authorized_payment). Header `x-signature` valida HMAC SHA256 con secret
 * compartido (ver `verify-signature.ts`).
 *
 * Eventos handled:
 *  - `subscription_preapproval` → GET /preapproval/{id} → UPDATE suscripciones.
 *  - `subscription_authorized_payment` → GET /authorized_payments/{id} →
 *    INSERT facturas (ON CONFLICT DO NOTHING por idempotencia) + UPDATE
 *    estado si approved/rejected.
 *  - Otros tipos → log + 200 OK silent.
 *
 * Response policy:
 *  - 401 SOLO si la firma falla (única excepción al 200-always).
 *  - 200 OK en TODOS los demás casos (incluyendo Zod fail o errores nuestros)
 *    porque MP reintenta hasta 200; no queremos amplificar bugs internos vía
 *    retry storm. Los errores se loguean a Sentry vía logger.error.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Parse body como JSON (necesitamos data.id para el manifest HMAC).
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.warn('mp webhook: body no es JSON valido');
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const parsed = MPWebhookEventSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn({ errors: parsed.error.flatten() }, 'mp webhook: shape invalido, ignorando event');
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const event = parsed.data;

  // 2. Verificación HMAC. Sin firma válida → 401 (única excepción).
  const signatureOk = verifyWebhookSignature({ req: request, dataId: event.data.id });
  if (!signatureOk) {
    logger.warn(
      { type: event.type, hasSig: Boolean(request.headers.get('x-signature')) },
      'mp webhook: firma invalida',
    );
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const admin = createServiceRoleClient();

  // 3. Dispatch por tipo de evento.
  try {
    switch (event.type) {
      case 'subscription_preapproval': {
        await handlePreapprovalEvent(admin, event.data.id);
        break;
      }
      case 'subscription_authorized_payment': {
        await handleAuthorizedPaymentEvent(admin, event.data.id);
        break;
      }
      default: {
        logger.info(
          { type: event.type, dataId: event.data.id },
          'mp webhook: tipo no manejado, ignorando',
        );
      }
    }
  } catch (err) {
    logger.error(
      { err, type: event.type, dataId: event.data.id },
      'mp webhook: error procesando evento',
    );
    // Igual respondemos 200 — no queremos retry storm de MP por bugs nuestros.
    // Sentry ya capturó el error vía logger.error.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

async function handlePreapprovalEvent(
  admin: ReturnType<typeof createServiceRoleClient>,
  preapprovalId: string,
): Promise<void> {
  const preapproval = await getPreapproval(preapprovalId);
  const nextEstado = mapPreapprovalStatus(preapproval.status);

  if (!nextEstado) {
    // status='pending' u otro intermedio → no overrideamos.
    logger.info(
      { preapprovalId, mpStatus: preapproval.status },
      'mp webhook: preapproval status sin mapeo, skip update',
    );
    return;
  }

  const patch: { estado: typeof nextEstado; cancelada_en?: string } = { estado: nextEstado };
  if (nextEstado === 'cancelada') {
    patch.cancelada_en = new Date().toISOString();
  }

  const { error, count } = await admin
    .from('suscripciones')
    .update(patch, { count: 'exact' })
    .eq('mp_subscription_id', preapprovalId);

  if (error) {
    throw new Error(`UPDATE suscripciones failed: ${error.message}`);
  }
  if (count === 0) {
    logger.warn(
      { preapprovalId, nextEstado },
      'mp webhook: ningun row matched mp_subscription_id (posible drift)',
    );
    return;
  }
  logger.info({ preapprovalId, nextEstado, count }, 'mp webhook: suscripcion estado actualizado');

  // T-074 · Dunning sync para cancelaciones. Fire-and-catch: si falla el send
  // (Resend caido, owner sin email, etc) loguemos pero NO rompemos webhook.
  if (nextEstado === 'cancelada') {
    try {
      const { data: sub } = await admin
        .from('suscripciones')
        .select('consultora_id, cancelar_en, mp_subscription_id')
        .eq('mp_subscription_id', preapprovalId)
        .maybeSingle();
      if (!sub) {
        logger.warn(
          { preapprovalId },
          'mp webhook: dunning skip — suscripcion no encontrada post-update',
        );
        return;
      }
      const { data: consultora } = await admin
        .from('consultoras')
        .select('id, name')
        .eq('id', sub.consultora_id)
        .maybeSingle();
      if (!consultora) return;
      const ownerInfo = await resolveConsultoraOwnerEmail(admin, sub.consultora_id);
      if (!ownerInfo) return;
      await sendSubscriptionCancelled(
        admin,
        { id: consultora.id, name: consultora.name },
        ownerInfo.ownerEmail,
        { mp_subscription_id: sub.mp_subscription_id, cancelar_en: sub.cancelar_en },
      );
    } catch (err) {
      logger.error(
        { err, preapprovalId },
        'mp webhook: sendSubscriptionCancelled failed (non-fatal)',
      );
    }
  }
}

async function handleAuthorizedPaymentEvent(
  admin: ReturnType<typeof createServiceRoleClient>,
  authorizedPaymentId: string,
): Promise<void> {
  const payment = await getAuthorizedPayment(authorizedPaymentId);

  // Lookup suscripcion + consultora para denormalizar el INSERT.
  const { data: sub, error: subErr } = await admin
    .from('suscripciones')
    .select('id, consultora_id')
    .eq('mp_subscription_id', payment.preapproval_id)
    .maybeSingle();

  if (subErr) {
    throw new Error(`SELECT suscripciones failed: ${subErr.message}`);
  }
  if (!sub) {
    logger.warn(
      { authorizedPaymentId, preapprovalId: payment.preapproval_id },
      'mp webhook: authorized_payment sin suscripcion match (posible drift)',
    );
    return;
  }

  const estado = mapAuthorizedPaymentStatus(payment.status);
  // MP devuelve transaction_amount EN PESOS con decimales. Convertimos a
  // centavos para alinear con `facturas.monto_centavos` (CHECK > 0, integer).
  const montoCentavos = Math.round(payment.transaction_amount * 100);

  const pagadaEn = estado === 'pagada' ? new Date().toISOString() : null;
  const razonFalla = estado === 'fallida' ? (payment.status_detail ?? null) : null;

  // Idempotencia: UNIQUE(mp_payment_id) + onConflict ignore. Si el mismo
  // mp_payment_id ya existe (MP reintentó el webhook), no insertamos
  // duplicate. Caller `upsert(..., { ignoreDuplicates: true })` devuelve 0
  // rows en ese caso — lo loguemos y salimos sin overrride de estado, porque
  // el primer webhook ya seteó el estado final.
  const { data: inserted, error: insErr } = await admin
    .from('facturas')
    .upsert(
      {
        consultora_id: sub.consultora_id,
        suscripcion_id: sub.id,
        monto_centavos: montoCentavos,
        moneda: payment.currency_id,
        estado,
        mp_payment_id: payment.id,
        pagada_en: pagadaEn,
        razon_falla: razonFalla,
      },
      { onConflict: 'mp_payment_id', ignoreDuplicates: true },
    )
    .select('id');

  if (insErr) {
    throw new Error(`UPSERT facturas failed: ${insErr.message}`);
  }

  if (!inserted || inserted.length === 0) {
    logger.info(
      { authorizedPaymentId, mpPaymentId: payment.id },
      'mp webhook: factura duplicada (idempotencia), skip',
    );
    return;
  }

  logger.info(
    {
      authorizedPaymentId,
      mpPaymentId: payment.id,
      suscripcionId: sub.id,
      consultoraId: sub.consultora_id,
      estado,
      montoCentavos,
    },
    'mp webhook: factura creada',
  );

  // T-074 · Dunning sync para pagos fallidos. Fire-and-catch: nunca rompe el webhook.
  if (estado === 'fallida') {
    try {
      const { data: consultora } = await admin
        .from('consultoras')
        .select('id, name')
        .eq('id', sub.consultora_id)
        .maybeSingle();
      if (!consultora) return;
      const ownerInfo = await resolveConsultoraOwnerEmail(admin, sub.consultora_id);
      if (!ownerInfo) return;
      await sendPaymentFailed(
        admin,
        { id: consultora.id, name: consultora.name },
        ownerInfo.ownerEmail,
        {
          mp_payment_id: payment.id,
          monto_centavos: montoCentavos,
          razon_falla: razonFalla,
        },
      );
    } catch (err) {
      logger.error(
        { err, mpPaymentId: payment.id, consultoraId: sub.consultora_id },
        'mp webhook: sendPaymentFailed failed (non-fatal)',
      );
    }
  }
}
