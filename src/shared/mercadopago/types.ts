import { z } from 'zod';

/**
 * T-071 · Schemas y tipos de Mercado Pago Subscriptions API.
 *
 * Sin `'use server'` para que el handler webhook y los server actions puedan
 * importar tanto Zod schemas como TS types sin error.
 *
 * Referencia API:
 *  - Subscriptions (preapproval): https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval/post
 *  - Webhooks: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
 */

// ============ Webhook events ============

/**
 * Body que MP postea al webhook. Estructura mínima documentada:
 *  - `type`: discriminador del evento (subscription_preapproval, subscription_authorized_payment, …).
 *  - `action`: subtipo (ej `updated`). Lo dejamos opcional — no lo necesitamos.
 *  - `data.id`: id del recurso afectado (preapproval_id ó authorized_payment_id).
 *  - `id`/`live_mode`/`date_created`/`user_id`/`api_version`: metadata MP, no
 *    los validamos shape (los pasamos a la firma HMAC tal como vienen).
 *
 * Tipos relevantes para T-071:
 *  - `subscription_preapproval` → cambios de estado del preapproval (authorized,
 *    paused, cancelled). Mapean a `suscripciones.estado`.
 *  - `subscription_authorized_payment` → cobro recurrente generado por MP a
 *    partir del preapproval. Mapea a INSERT en `facturas`.
 *
 * Otros tipos (`payment`, `merchant_order`, `topic_*`, …) se loguean + 200 OK
 * sin tocar DB.
 */
export const MPWebhookEventSchema = z.object({
  type: z.string(),
  action: z.string().optional(),
  data: z.object({
    id: z.string().min(1),
  }),
});

export type MPWebhookEvent = z.infer<typeof MPWebhookEventSchema>;

// ============ Preapproval ============

/**
 * Subset del response de POST /preapproval que consumimos.
 *
 * MP devuelve más fields (back_url, payer_id, reason, status, transaction_amount,
 * currency_id, …). Los demás se ignoran con Zod default behavior (`.passthrough`
 * NO se setea — preferimos strip silent).
 */
export const PreapprovalResponseSchema = z.object({
  id: z.string().min(1),
  init_point: z.string().url(),
  status: z.string(),
});

export type PreapprovalResponse = z.infer<typeof PreapprovalResponseSchema>;

// Status MP del preapproval. No validamos como enum porque MP puede agregar
// values sin avisar — preferimos string + mapeo defensivo en el webhook handler.
export type PreapprovalStatus = 'pending' | 'authorized' | 'paused' | 'cancelled';

/**
 * Map MP preapproval status → estado_suscripcion (enum Postgres T-070+FU1).
 *
 * - `authorized` → activa (cobro recurrente OK).
 * - `paused`     → morosa (MP detectó falla de cobro y pausó hasta retry/fix).
 * - `cancelled`  → cancelada (user pidió + MP confirmó).
 * - `pending`    → ignorar (estado intermedio MP, ya mapeamos a
 *   `pendiente_autorizacion` en el INSERT del action; no overrideamos).
 */
export function mapPreapprovalStatus(status: string): 'activa' | 'morosa' | 'cancelada' | null {
  switch (status) {
    case 'authorized':
      return 'activa';
    case 'paused':
      return 'morosa';
    case 'cancelled':
      return 'cancelada';
    default:
      return null;
  }
}

// ============ Authorized payment (cobro recurrente) ============

/**
 * Subset del response de GET /authorized_payments/{id}.
 *
 * Fields que consumimos:
 *  - `id`: payment_id, idempotency key para `facturas.mp_payment_id`.
 *  - `preapproval_id`: lookup de la suscripcion en nuestra DB.
 *  - `transaction_amount`: monto del cobro EN PESOS con decimales (MP no usa
 *    centavos en este endpoint). Convertimos a centavos antes de insert.
 *  - `currency_id`: 'ARS' | 'USD'.
 *  - `status`: 'approved' | 'rejected' | otros estados intermedios MP.
 *  - `status_detail` (opcional): razón legible si el cobro falla
 *    (ej "cc_rejected_insufficient_amount"). Lo guardamos en `razon_falla`.
 */
export const AuthorizedPaymentResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  preapproval_id: z.string().min(1),
  transaction_amount: z.number().positive(),
  currency_id: z.string().min(1),
  status: z.string(),
  status_detail: z.string().optional().nullable(),
});

export type AuthorizedPaymentResponse = z.infer<typeof AuthorizedPaymentResponseSchema>;

/**
 * Map MP authorized_payment status → estado_factura (enum Postgres T-070).
 *
 * - `approved` → pagada.
 * - `rejected` → fallida.
 * - `refunded` → reembolsada.
 * - Otros (`in_process`, `pending`, …) → 'pendiente' (estado por defecto del
 *   INSERT). El webhook puede llegar con un estado intermedio y luego el final.
 */
export function mapAuthorizedPaymentStatus(
  status: string,
): 'pagada' | 'fallida' | 'reembolsada' | 'pendiente' {
  switch (status) {
    case 'approved':
      return 'pagada';
    case 'rejected':
      return 'fallida';
    case 'refunded':
      return 'reembolsada';
    default:
      return 'pendiente';
  }
}
