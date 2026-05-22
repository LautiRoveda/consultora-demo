import 'server-only';

import type { NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@/env';

/**
 * T-071 · Verificación HMAC SHA256 del webhook de Mercado Pago.
 *
 * Algoritmo (docs oficiales MP):
 *   https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks#signature-validation
 *
 *  1. Extraer header `x-signature`, formato `ts=<unix_ms>,v1=<hex_sha256>`.
 *  2. Extraer header `x-request-id`.
 *  3. Tomar `data.id` del body (lo recibimos pre-parseado del caller).
 *  4. Construir manifest:
 *        `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 *  5. `hmac = HMAC_SHA256(MP_WEBHOOK_SECRET, manifest).hex`
 *  6. Comparar `hmac` con `v1` usando timing-safe equal (defensa side-channel).
 *  7. Rechazar si `ts` > 5min vs `Date.now()` (anti-replay).
 *
 * Retorna boolean — el caller decide el response code (401 si false).
 */

const MAX_TS_SKEW_MS = 5 * 60_000; // 5 minutos

export interface VerifySignatureInput {
  /** El request entrante (de donde leemos headers). */
  req: NextRequest;
  /** `data.id` del body MP — el caller ya lo parseó vía Zod. */
  dataId: string;
  /** Fuente del "ahora" (inyectable para tests deterministas con vectores fijos). */
  now?: () => number;
}

export function verifyWebhookSignature(input: VerifySignatureInput): boolean {
  const { req, dataId, now = Date.now } = input;

  const sigHeader = req.headers.get('x-signature');
  const requestId = req.headers.get('x-request-id');
  if (!sigHeader || !requestId) return false;

  // Parse `ts=...,v1=...` (orden no garantizado por MP).
  const parts = sigHeader.split(',').map((p) => p.trim());
  let ts: string | undefined;
  let v1: string | undefined;
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();
    if (k === 'ts') ts = v;
    else if (k === 'v1') v1 = v;
  }

  if (!ts || !v1) return false;

  // Anti-replay: rechazar timestamps fuera de ventana ±5min.
  const tsMs = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsMs)) return false;
  if (Math.abs(now() - tsMs) > MAX_TS_SKEW_MS) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = createHmac('sha256', env.MP_WEBHOOK_SECRET).update(manifest).digest('hex');

  // timingSafeEqual exige Buffers del mismo length — abortamos antes.
  if (expected.length !== v1.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(v1, 'utf8'));
  } catch {
    return false;
  }
}
