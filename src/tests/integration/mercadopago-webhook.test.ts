/**
 * T-071 · Integration tests del route handler POST /api/webhooks/mercadopago.
 *
 * Cobertura:
 *  1. POST sin firma → 401.
 *  2. POST con firma inválida → 401.
 *  3. POST con body no-JSON → 200 silent.
 *  4. POST con shape inválido (Zod fail) → 200 silent.
 *  5. Event type desconocido → 200 + no DB changes.
 *  6. subscription_preapproval status=authorized → UPDATE estado='activa'.
 *  7. subscription_preapproval status=cancelled → UPDATE estado='cancelada' +
 *     cancelada_en seteado.
 *  8. subscription_preapproval status=paused → UPDATE estado='morosa'.
 *  9. subscription_preapproval con mp_subscription_id que no matchea →
 *     200 + log warn + no DB changes.
 * 10. subscription_authorized_payment approved → INSERT factura
 *     (estado='pagada' + pagada_en seteado).
 * 11. Idempotency: 2× mismo authorized_payment id → 1 sola factura.
 * 12. subscription_authorized_payment rejected → INSERT con
 *     estado='fallida' + razon_falla.
 *
 * Mocks:
 *  - @/shared/mercadopago/client: getPreapproval + getAuthorizedPayment
 *    devuelven payloads controlados (NO pegamos a MP real).
 *  - server-only: stub.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createHmac } from 'node:crypto';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Import del handler AL FINAL para que los mocks aplicen.
import { POST } from '@/app/api/webhooks/mercadopago/route';
import { env } from '@/env';

vi.mock('server-only', () => ({}));

const getPreapprovalMock = vi.fn();
const getAuthorizedPaymentMock = vi.fn();
vi.mock('@/shared/mercadopago/client', async () => {
  // Re-exportamos MercadoPagoError (clase real, no la mockeamos) por si el
  // SUT la usa en typeof checks.
  const actual = await vi.importActual<typeof import('@/shared/mercadopago/client')>(
    '@/shared/mercadopago/client',
  );
  return {
    ...actual,
    getPreapproval: (...args: unknown[]) => getPreapprovalMock(...args),
    getAuthorizedPayment: (...args: unknown[]) => getAuthorizedPaymentMock(...args),
  };
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `t071-wh-${runId}`;

let cId: string;
let subId: string;
let mpSubId: string;

const SECRET = env.MP_WEBHOOK_SECRET;

function signManifest(dataId: string, requestId: string, ts: number): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return createHmac('sha256', SECRET).update(manifest).digest('hex');
}

function makeRequest(opts: {
  body: unknown;
  validSignature?: boolean;
  dataIdForSignature?: string;
  requestId?: string;
  ts?: number;
}): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.validSignature !== false) {
    const requestId = opts.requestId ?? `req-${Date.now()}`;
    const ts = opts.ts ?? Date.now();
    const dataId =
      opts.dataIdForSignature ??
      (typeof opts.body === 'object' && opts.body !== null && 'data' in opts.body
        ? (opts.body as { data: { id: string } }).data.id
        : 'unknown');
    const v1 = signManifest(dataId, requestId, ts);
    headers['x-signature'] = `ts=${ts},v1=${v1}`;
    headers['x-request-id'] = requestId;
  } else if (opts.validSignature === false) {
    headers['x-signature'] = `ts=${Date.now()},v1=invalid_signature_hash`;
    headers['x-request-id'] = 'req-bad';
  }
  return new NextRequest('http://localhost/api/webhooks/mercadopago', {
    method: 'POST',
    headers,
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
}

beforeAll(async () => {
  const { data: c, error: cErr } = await admin
    .from('consultoras')
    .insert({ name: 'T071 WH', slug })
    .select('id')
    .single();
  if (cErr) throw cErr;
  cId = c.id;
});

afterAll(async () => {
  await admin.from('consultoras').delete().eq('id', cId);
});

beforeEach(async () => {
  getPreapprovalMock.mockReset();
  getAuthorizedPaymentMock.mockReset();
  // Cada test crea una suscripcion nueva con mp_subscription_id único.
  mpSubId = `mp-pre-${runId}-${Math.random().toString(36).slice(2, 8)}`;
  const periodoInicio = new Date().toISOString();
  const periodoFin = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const { data: sub, error: sErr } = await admin
    .from('suscripciones')
    .insert({
      consultora_id: cId,
      plan_codigo: 'pro_mensual',
      estado: 'pendiente_autorizacion',
      mp_subscription_id: mpSubId,
      periodo_inicio: periodoInicio,
      periodo_fin: periodoFin,
    })
    .select('id')
    .single();
  if (sErr) throw sErr;
  subId = sub.id;
});

afterEach(async () => {
  // Cleanup FK-aware: facturas → suscripciones.
  await admin.from('facturas').delete().eq('suscripcion_id', subId);
  await admin.from('suscripciones').delete().eq('id', subId);
});

describe('mercadopago webhook · auth', () => {
  it('1. POST sin headers de firma → 401', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/mercadopago', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'subscription_preapproval', data: { id: mpSubId } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('2. POST con firma inválida → 401', async () => {
    const req = makeRequest({
      body: { type: 'subscription_preapproval', data: { id: mpSubId } },
      validSignature: false,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('3. POST con body no-JSON → 200 silent', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/mercadopago', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('4. POST con shape inválido (Zod fail) → 200 silent', async () => {
    const req = makeRequest({ body: { foo: 'bar' } });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(getPreapprovalMock).not.toHaveBeenCalled();
  });
});

describe('mercadopago webhook · subscription_preapproval', () => {
  it('5. event type desconocido → 200 + no DB change', async () => {
    const req = makeRequest({ body: { type: 'merchant_order', data: { id: 'mo-123' } } });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { data: sub } = await admin
      .from('suscripciones')
      .select('estado')
      .eq('id', subId)
      .single();
    expect(sub?.estado).toBe('pendiente_autorizacion');
  });

  it('6. preapproval status=authorized → UPDATE estado=activa', async () => {
    getPreapprovalMock.mockResolvedValueOnce({
      id: mpSubId,
      init_point: 'https://www.mercadopago.com.ar/preapproval?preapproval_id=' + mpSubId,
      status: 'authorized',
    });

    const req = makeRequest({
      body: { type: 'subscription_preapproval', data: { id: mpSubId } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(getPreapprovalMock).toHaveBeenCalledWith(mpSubId);

    const { data: sub } = await admin
      .from('suscripciones')
      .select('estado, cancelada_en')
      .eq('id', subId)
      .single();
    expect(sub?.estado).toBe('activa');
    expect(sub?.cancelada_en).toBeNull();
  });

  it('7. preapproval status=cancelled → UPDATE estado=cancelada + cancelada_en', async () => {
    getPreapprovalMock.mockResolvedValueOnce({
      id: mpSubId,
      init_point: 'https://www.mercadopago.com.ar/preapproval?preapproval_id=' + mpSubId,
      status: 'cancelled',
    });

    const req = makeRequest({
      body: { type: 'subscription_preapproval', data: { id: mpSubId } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { data: sub } = await admin
      .from('suscripciones')
      .select('estado, cancelada_en')
      .eq('id', subId)
      .single();
    expect(sub?.estado).toBe('cancelada');
    expect(sub?.cancelada_en).not.toBeNull();
  });

  it('8. preapproval status=paused → UPDATE estado=morosa', async () => {
    getPreapprovalMock.mockResolvedValueOnce({
      id: mpSubId,
      init_point: 'https://www.mercadopago.com.ar/preapproval?preapproval_id=' + mpSubId,
      status: 'paused',
    });

    const req = makeRequest({
      body: { type: 'subscription_preapproval', data: { id: mpSubId } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { data: sub } = await admin
      .from('suscripciones')
      .select('estado')
      .eq('id', subId)
      .single();
    expect(sub?.estado).toBe('morosa');
  });

  it('9. preapproval con mp_subscription_id que no matchea → 200 + no DB change', async () => {
    const ghostId = `mp-ghost-${runId}`;
    getPreapprovalMock.mockResolvedValueOnce({
      id: ghostId,
      init_point: 'https://example.com',
      status: 'authorized',
    });

    const req = makeRequest({
      body: { type: 'subscription_preapproval', data: { id: ghostId } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { data: sub } = await admin
      .from('suscripciones')
      .select('estado')
      .eq('id', subId)
      .single();
    expect(sub?.estado).toBe('pendiente_autorizacion');
  });
});

describe('mercadopago webhook · subscription_authorized_payment', () => {
  it('10. authorized_payment approved → INSERT factura estado=pagada + pagada_en', async () => {
    const paymentId = `mp-pay-${runId}-10`;
    getAuthorizedPaymentMock.mockResolvedValueOnce({
      id: paymentId,
      preapproval_id: mpSubId,
      transaction_amount: 30000.0, // ARS 30.000 = 3.000.000 centavos
      currency_id: 'ARS',
      status: 'approved',
      status_detail: null,
    });

    const req = makeRequest({
      body: { type: 'subscription_authorized_payment', data: { id: paymentId } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { data: facturas } = await admin
      .from('facturas')
      .select('mp_payment_id, monto_centavos, moneda, estado, pagada_en, razon_falla')
      .eq('suscripcion_id', subId);
    expect(facturas).toHaveLength(1);
    const f = facturas![0]!;
    expect(f.mp_payment_id).toBe(paymentId);
    expect(f.monto_centavos).toBe(3_000_000);
    expect(f.moneda).toBe('ARS');
    expect(f.estado).toBe('pagada');
    expect(f.pagada_en).not.toBeNull();
    expect(f.razon_falla).toBeNull();
  });

  it('11. Idempotency: 2× mismo authorized_payment id → 1 sola factura', async () => {
    const paymentId = `mp-pay-${runId}-11`;
    const payload = {
      id: paymentId,
      preapproval_id: mpSubId,
      transaction_amount: 30000.0,
      currency_id: 'ARS',
      status: 'approved',
      status_detail: null,
    };
    getAuthorizedPaymentMock.mockResolvedValue(payload);

    const req1 = makeRequest({
      body: { type: 'subscription_authorized_payment', data: { id: paymentId } },
      requestId: 'req-idem-1',
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    const req2 = makeRequest({
      body: { type: 'subscription_authorized_payment', data: { id: paymentId } },
      requestId: 'req-idem-2',
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);

    const { data: facturas } = await admin
      .from('facturas')
      .select('id')
      .eq('mp_payment_id', paymentId);
    expect(facturas).toHaveLength(1);
  });

  it('12. authorized_payment rejected → INSERT estado=fallida + razon_falla', async () => {
    const paymentId = `mp-pay-${runId}-12`;
    getAuthorizedPaymentMock.mockResolvedValueOnce({
      id: paymentId,
      preapproval_id: mpSubId,
      transaction_amount: 30000.0,
      currency_id: 'ARS',
      status: 'rejected',
      status_detail: 'cc_rejected_insufficient_amount',
    });

    const req = makeRequest({
      body: { type: 'subscription_authorized_payment', data: { id: paymentId } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { data: facturas } = await admin
      .from('facturas')
      .select('estado, razon_falla, pagada_en')
      .eq('mp_payment_id', paymentId);
    expect(facturas).toHaveLength(1);
    const f = facturas![0]!;
    expect(f.estado).toBe('fallida');
    expect(f.razon_falla).toBe('cc_rejected_insufficient_amount');
    expect(f.pagada_en).toBeNull();
  });
});
