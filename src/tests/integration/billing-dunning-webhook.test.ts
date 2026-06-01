/**
 * T-074 · Integration tests de hooks dunning en webhook MP.
 *
 * Verifica que post-INSERT factura.estado='fallida' y post-UPDATE
 * suscripciones.estado='cancelada' se disparen los senders dunning
 * sin romper la respuesta 200 OK del webhook (fire-and-catch).
 *
 * Cubre:
 *  1. authorized_payment status=rejected -> log row tipo='payment_failed'
 *     + Resend invocado.
 *  2. preapproval status=cancelled -> log row tipo='subscription_cancelled'
 *     + Resend invocado.
 *  3. Idempotency: 2 webhooks consecutivos con misma factura/sub -> 1 sola
 *     log row dunning.
 *
 * Mocks: mercadopago client, server-only, resend.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createHmac } from 'node:crypto';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/webhooks/mercadopago/route';
import { env } from '@/env';

vi.mock('server-only', () => ({}));

const getPreapprovalMock = vi.fn();
const getAuthorizedPaymentMock = vi.fn();
vi.mock('@/shared/mercadopago/client', async () => {
  const actual = await vi.importActual<typeof import('@/shared/mercadopago/client')>(
    '@/shared/mercadopago/client',
  );
  return {
    ...actual,
    getPreapproval: (...args: unknown[]) => getPreapprovalMock(...args),
    getAuthorizedPayment: (...args: unknown[]) => getAuthorizedPaymentMock(...args),
  };
});

const mockEmailsSend = vi.fn();
vi.mock('@/shared/notifications/resend', () => ({
  getResendClient: () => ({
    emails: { send: mockEmailsSend },
  }),
}));

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
const slug = `t074-wh-${runId}`;
const ownerEmail = `t074-wh-owner-${runId}@example.com`;

let cId: string;
let ownerId: string;
let subId: string;
let mpSubId: string;

const SECRET = env.MP_WEBHOOK_SECRET;

function signManifest(dataId: string, requestId: string, ts: number): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return createHmac('sha256', SECRET).update(manifest).digest('hex');
}

function makeRequest(opts: {
  body: unknown;
  dataIdForSignature?: string;
  requestId?: string;
  ts?: number;
}): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
  return new NextRequest('http://localhost/api/webhooks/mercadopago', {
    method: 'POST',
    headers,
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
}

beforeAll(async () => {
  const { data: c } = await admin
    .from('consultoras')
    .insert({ name: 'T074 WH', slug })
    .select('id')
    .single();
  cId = c!.id;

  const { data: u } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: 'TestPassword123!',
    email_confirm: true,
  });
  ownerId = u.user!.id;
  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: cId, role: 'owner' });
});

afterAll(async () => {
  // billing_notifications_log es append-only/inmutable (AUD-001/CHORE-C): no se limpia.
  // Las queries del test scopean por ref_id (F1.3), así que las filas residuales no
  // interfieren; la DB efímera las resetea por run. Ver T-113b.
  await admin.from('consultoras').delete().eq('id', cId);
  await admin.auth.admin.deleteUser(ownerId).catch(() => {});
});

beforeEach(async () => {
  getPreapprovalMock.mockReset();
  getAuthorizedPaymentMock.mockReset();
  mockEmailsSend.mockReset();
  mockEmailsSend.mockImplementation(() =>
    Promise.resolve({
      data: { id: `rsd_${Math.random().toString(36).slice(2, 8)}` },
      error: null,
    }),
  );

  mpSubId = `mp-pre-${runId}-${Math.random().toString(36).slice(2, 8)}`;
  const periodoInicio = new Date().toISOString();
  const periodoFin = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const { data: sub } = await admin
    .from('suscripciones')
    .insert({
      consultora_id: cId,
      plan_codigo: 'pro_mensual',
      estado: 'activa',
      mp_subscription_id: mpSubId,
      periodo_inicio: periodoInicio,
      periodo_fin: periodoFin,
    })
    .select('id')
    .single();
  subId = sub!.id;
});

afterEach(async () => {
  // billing_notifications_log es append-only (AUD-001): el DELETE lanza excepción y las
  // filas no se borran. Por eso cada test scopea sus queries por ref_id único
  // (paymentId / mpSubId) en vez de contar todas las filas de la consultora.
  await admin.from('facturas').delete().eq('suscripcion_id', subId);
  await admin.from('suscripciones').delete().eq('id', subId);
});

describe('webhook MP · dunning hook payment_failed', () => {
  it('1. authorized_payment rejected -> log row payment_failed + Resend send', async () => {
    const paymentId = `mp-pay-${runId}-fail-${Math.random().toString(36).slice(2, 6)}`;
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

    // Factura inserted con estado='fallida'.
    const { data: facturas } = await admin
      .from('facturas')
      .select('estado, razon_falla, mp_payment_id')
      .eq('mp_payment_id', paymentId);
    expect(facturas).toHaveLength(1);
    expect(facturas![0]!.estado).toBe('fallida');

    // Resend invocado con email del owner.
    expect(mockEmailsSend).toHaveBeenCalled();
    const sendArgs = mockEmailsSend.mock.calls[0]![0];
    expect(sendArgs.to).toBe(ownerEmail);
    expect(sendArgs.subject).toContain('No pudimos procesar tu pago');

    // Log row tipo='payment_failed' con ref_id=mp_payment_id.
    const { data: logs } = await admin
      .from('billing_notifications_log')
      .select('tipo, ref_id, resend_email_id')
      .eq('consultora_id', cId)
      .eq('tipo', 'payment_failed');
    expect(logs).toHaveLength(1);
    expect(logs![0]!.ref_id).toBe(paymentId);
    expect(logs![0]!.resend_email_id).toMatch(/^rsd_/);
  });

  it('2. authorized_payment approved -> NO dispara dunning', async () => {
    const paymentId = `mp-pay-${runId}-ok-${Math.random().toString(36).slice(2, 6)}`;
    getAuthorizedPaymentMock.mockResolvedValueOnce({
      id: paymentId,
      preapproval_id: mpSubId,
      transaction_amount: 30000.0,
      currency_id: 'ARS',
      status: 'approved',
      status_detail: null,
    });

    const req = makeRequest({
      body: { type: 'subscription_authorized_payment', data: { id: paymentId } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockEmailsSend).not.toHaveBeenCalled();

    // Scope por ref_id: el log es append-only (AUD-001) y puede traer filas de otros
    // tests; verificamos que ESTE pago no generó dunning.
    const { data: logs } = await admin
      .from('billing_notifications_log')
      .select('id')
      .eq('consultora_id', cId)
      .eq('tipo', 'payment_failed')
      .eq('ref_id', paymentId);
    expect(logs).toHaveLength(0);
  });

  it('3. mismo authorized_payment 2x -> 1 sola log row dunning (idempotency)', async () => {
    const paymentId = `mp-pay-${runId}-idem-${Math.random().toString(36).slice(2, 6)}`;
    const payload = {
      id: paymentId,
      preapproval_id: mpSubId,
      transaction_amount: 30000.0,
      currency_id: 'ARS',
      status: 'rejected',
      status_detail: 'cc_rejected_call_for_authorize',
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

    // Resend invocado solo 1 vez (segunda factura es duplicate, no entra al hook).
    expect(mockEmailsSend).toHaveBeenCalledTimes(1);

    const { data: logs } = await admin
      .from('billing_notifications_log')
      .select('id, ref_id')
      .eq('consultora_id', cId)
      .eq('tipo', 'payment_failed')
      .eq('ref_id', paymentId);
    expect(logs).toHaveLength(1);
    expect(logs![0]!.ref_id).toBe(paymentId);
  });
});

describe('webhook MP · dunning hook subscription_cancelled', () => {
  it('4. preapproval cancelled -> log row subscription_cancelled + Resend send', async () => {
    getPreapprovalMock.mockResolvedValueOnce({
      id: mpSubId,
      init_point: 'https://example.com',
      status: 'cancelled',
    });

    const req = makeRequest({
      body: { type: 'subscription_preapproval', data: { id: mpSubId } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Suscripcion updated a cancelada.
    const { data: sub } = await admin
      .from('suscripciones')
      .select('estado, cancelada_en')
      .eq('id', subId)
      .single();
    expect(sub?.estado).toBe('cancelada');

    // Resend invocado.
    expect(mockEmailsSend).toHaveBeenCalled();
    const sendArgs = mockEmailsSend.mock.calls[0]![0];
    expect(sendArgs.to).toBe(ownerEmail);
    expect(sendArgs.subject).toContain('Tu suscripción fue cancelada');

    // Log row tipo='subscription_cancelled'.
    const { data: logs } = await admin
      .from('billing_notifications_log')
      .select('tipo, ref_id')
      .eq('consultora_id', cId)
      .eq('tipo', 'subscription_cancelled');
    expect(logs).toHaveLength(1);
    expect(logs![0]!.ref_id).toBe(mpSubId);
  });

  it('5. preapproval authorized -> NO dispara dunning', async () => {
    getPreapprovalMock.mockResolvedValueOnce({
      id: mpSubId,
      init_point: 'https://example.com',
      status: 'authorized',
    });

    const req = makeRequest({
      body: { type: 'subscription_preapproval', data: { id: mpSubId } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockEmailsSend).not.toHaveBeenCalled();
    // Scope por ref_id: el log es append-only (AUD-001) y puede traer filas de otros
    // tests; verificamos que ESTE preapproval no generó dunning.
    const { data: logs } = await admin
      .from('billing_notifications_log')
      .select('id')
      .eq('consultora_id', cId)
      .eq('tipo', 'subscription_cancelled')
      .eq('ref_id', mpSubId);
    expect(logs).toHaveLength(0);
  });
});
