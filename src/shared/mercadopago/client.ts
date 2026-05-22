import 'server-only';

import type { AuthorizedPaymentResponse, PreapprovalResponse } from './types';

import { env } from '@/env';

import { AuthorizedPaymentResponseSchema, PreapprovalResponseSchema } from './types';

/**
 * T-071 · Cliente HTTP para Mercado Pago Subscriptions API.
 *
 * Usamos `fetch` directo (sin SDK oficial `mercadopago`) por 3 razones:
 *  1. Menos surface: cubrimos 3 endpoints del flujo subscription, no necesitamos
 *     el resto del catálogo del SDK.
 *  2. Menos deps en el bundle final.
 *  3. Mejor control de errors (el SDK envuelve responses en clases custom).
 *
 * Endpoints cubiertos:
 *  - POST /preapproval                          → crear suscripcion.
 *  - PUT  /preapproval/{id}                     → cancelar suscripcion.
 *  - GET  /preapproval/{id}                     → refetch estado authoritative.
 *  - GET  /authorized_payments/{id}             → detalle del cobro recurrente.
 *
 * Auth: header `Authorization: Bearer <MP_ACCESS_TOKEN>`. Dev usa TEST-... ,
 * prod usa APP_USR-... — el código es agnóstico.
 */

const MP_BASE_URL = 'https://api.mercadopago.com';

/**
 * Error tipado para distinguir fallas de MP de bugs nuestros. El caller
 * decide retry/fallback. El campo `body` puede ser cualquier cosa (string
 * raw si MP devuelve text, JSON si fue parseable).
 */
export class MercadoPagoError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'MercadoPagoError';
    this.status = status;
    this.body = body;
  }
}

async function mpFetch<T>(
  path: string,
  init: RequestInit,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
): Promise<T> {
  const res = await fetch(`${MP_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  const raw = await res.text();
  let parsedBody: unknown;
  try {
    parsedBody = raw ? JSON.parse(raw) : null;
  } catch {
    parsedBody = raw;
  }

  if (!res.ok) {
    throw new MercadoPagoError(
      `MP ${init.method ?? 'GET'} ${path} failed: ${res.status}`,
      res.status,
      parsedBody,
    );
  }

  const parsed = schema.safeParse(parsedBody);
  if (!parsed.success) {
    throw new MercadoPagoError(
      `MP ${init.method ?? 'GET'} ${path} response shape inválido`,
      res.status,
      parsedBody,
    );
  }
  return parsed.data;
}

// ============ Preapproval (suscripcion) ============

export interface CreatePreapprovalInput {
  payerEmail: string;
  /** Monto del cobro EN PESOS con decimales (MP NO usa centavos en este endpoint). */
  transactionAmountPesos: number;
  /** Razón legible que MP muestra en el checkout (ej "ConsultoraDemo Pro · mensual"). */
  reason: string;
  /** URL absoluta a la que MP redirige al user post-checkout. */
  backUrl: string;
  /** Override de start_date (ISO). Por defecto now(). */
  startDate?: string;
}

/**
 * Crea un preapproval mensual ARS con start_date inmediato. El user es
 * redirigido a `init_point` y MP nos notifica via webhook con el resultado
 * de la autorización (subscription_preapproval status=authorized|cancelled).
 *
 * Frequency mensual está hardcoded porque `plan_codigo` T-070 solo tiene
 * `pro_mensual`. Cuando agreguemos `pro_anual` parametrizamos.
 */
export async function createPreapproval(
  input: CreatePreapprovalInput,
): Promise<PreapprovalResponse> {
  const startDate = input.startDate ?? new Date().toISOString();
  return mpFetch(
    '/preapproval',
    {
      method: 'POST',
      body: JSON.stringify({
        reason: input.reason,
        back_url: input.backUrl,
        payer_email: input.payerEmail,
        status: 'pending',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: input.transactionAmountPesos,
          currency_id: 'ARS',
          start_date: startDate,
        },
      }),
    },
    PreapprovalResponseSchema,
  );
}

/**
 * Cancela un preapproval. MP nos notifica vía webhook
 * (subscription_preapproval status=cancelled). El server action set
 * `cancelar_en = now()` ANTES de llamar acá; el webhook luego seta
 * `cancelada_en` + `estado='cancelada'`.
 */
export async function cancelPreapproval(preapprovalId: string): Promise<void> {
  await mpFetch(
    `/preapproval/${encodeURIComponent(preapprovalId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ status: 'cancelled' }),
    },
    PreapprovalResponseSchema,
  );
}

/** Refetch authoritative del preapproval (usado por el webhook). */
export async function getPreapproval(preapprovalId: string): Promise<PreapprovalResponse> {
  return mpFetch(
    `/preapproval/${encodeURIComponent(preapprovalId)}`,
    { method: 'GET' },
    PreapprovalResponseSchema,
  );
}

// ============ Authorized payment (cobro recurrente) ============

/**
 * Lookup del cobro recurrente. El webhook subscription_authorized_payment
 * NO trae preapproval_id en el body — hay que pegarle a este endpoint para
 * derivarlo y matchearlo con `suscripciones.mp_subscription_id`.
 */
export async function getAuthorizedPayment(
  authorizedPaymentId: string,
): Promise<AuthorizedPaymentResponse> {
  return mpFetch(
    `/authorized_payments/${encodeURIComponent(authorizedPaymentId)}`,
    { method: 'GET' },
    AuthorizedPaymentResponseSchema,
  );
}
