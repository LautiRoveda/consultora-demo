import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { verifyWebhookSignature } from '@/shared/mercadopago/verify-signature';

vi.mock('server-only', () => ({}));

// env.ts safeParse al cargar; hoist vars antes del import del SUT.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://hoisted.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'hoisted-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'hoisted-service-role-key';
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://hoisted@o0.ingest.sentry.io/0';
  process.env.SENTRY_ORG = 'hoisted-org';
  process.env.SENTRY_PROJECT = 'hoisted-project';
  process.env.ANTHROPIC_API_KEY = 'hoisted-anthropic-key';
  process.env.RESEND_API_KEY = 'hoisted-resend-key';
  process.env.RESEND_FROM_ADDRESS = 'hoisted@example.com';
  process.env.INTERNAL_CRON_SECRET = 'hoisted-cron-secret-32-chars-min-aaa';
  process.env.TELEGRAM_BOT_TOKEN = 'hoisted-tg-token-40-chars-min-aaaaaaaaaaaaaaaa';
  process.env.TELEGRAM_BOT_USERNAME = 'hoisted_bot';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hoisted-tg-webhook-secret-32-chars-aaaa';
  process.env.VAPID_PRIVATE_KEY = 'hoisted-vapid-private-key-44-chars-b64url-aaa';
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY =
    'hoisted-vapid-public-key-88-chars-b64url-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  process.env.ARS_PRICE_MONTHLY = '3000000';
  // El SUT lee MP_WEBHOOK_SECRET via env.ts.
  process.env.MP_ACCESS_TOKEN = 'hoisted-mp-access-token-40-chars-minimum-aaaaa';
  process.env.MP_WEBHOOK_SECRET = 'hoisted-mp-webhook-secret-32-chars-aaaaa';
});

const SECRET = 'hoisted-mp-webhook-secret-32-chars-aaaaa';

function signManifest(secret: string, manifest: string): string {
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

function buildRequest(opts: {
  ts?: string | null;
  v1?: string;
  requestId?: string | null;
  signatureHeader?: string | null; // override explicito completo
}): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.signatureHeader !== undefined) {
    if (opts.signatureHeader !== null) headers['x-signature'] = opts.signatureHeader;
  } else if (opts.ts !== null && opts.v1) {
    const parts: string[] = [];
    if (opts.ts) parts.push(`ts=${opts.ts}`);
    parts.push(`v1=${opts.v1}`);
    headers['x-signature'] = parts.join(',');
  }
  if (opts.requestId !== null && opts.requestId !== undefined) {
    headers['x-request-id'] = opts.requestId;
  }
  return new NextRequest('http://localhost/api/webhooks/mercadopago', {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'subscription_preapproval', data: { id: 'pre-123' } }),
  });
}

describe('verifyWebhookSignature', () => {
  it('acepta firma válida con ts actual', () => {
    const now = Date.now();
    const dataId = 'pre-123';
    const requestId = 'req-abc';
    const manifest = `id:${dataId};request-id:${requestId};ts:${now};`;
    const v1 = signManifest(SECRET, manifest);

    const req = buildRequest({ ts: String(now), v1, requestId });
    expect(verifyWebhookSignature({ req, dataId, now: () => now })).toBe(true);
  });

  it('acepta firma con ts antes del v1 (orden alternativo)', () => {
    const now = Date.now();
    const dataId = 'pre-123';
    const requestId = 'req-abc';
    const manifest = `id:${dataId};request-id:${requestId};ts:${now};`;
    const v1 = signManifest(SECRET, manifest);

    const req = new NextRequest('http://localhost/api/webhooks/mercadopago', {
      method: 'POST',
      headers: {
        'x-signature': `v1=${v1},ts=${now}`,
        'x-request-id': requestId,
      },
    });
    expect(verifyWebhookSignature({ req, dataId, now: () => now })).toBe(true);
  });

  it('rechaza si falta header x-signature', () => {
    const dataId = 'pre-123';
    const req = buildRequest({ signatureHeader: null, requestId: 'req-abc' });
    expect(verifyWebhookSignature({ req, dataId, now: () => Date.now() })).toBe(false);
  });

  it('rechaza si falta header x-request-id', () => {
    const now = Date.now();
    const dataId = 'pre-123';
    const manifest = `id:${dataId};request-id:req-abc;ts:${now};`;
    const v1 = signManifest(SECRET, manifest);
    const req = buildRequest({ ts: String(now), v1, requestId: null });
    expect(verifyWebhookSignature({ req, dataId, now: () => now })).toBe(false);
  });

  it('rechaza firma inválida (secret distinto)', () => {
    const now = Date.now();
    const dataId = 'pre-123';
    const requestId = 'req-abc';
    const manifest = `id:${dataId};request-id:${requestId};ts:${now};`;
    const v1 = signManifest('otro-secret-distinto', manifest);

    const req = buildRequest({ ts: String(now), v1, requestId });
    expect(verifyWebhookSignature({ req, dataId, now: () => now })).toBe(false);
  });

  it('rechaza si dataId no matchea el firmado (tamper)', () => {
    const now = Date.now();
    const requestId = 'req-abc';
    const manifestOriginal = `id:pre-aaa;request-id:${requestId};ts:${now};`;
    const v1 = signManifest(SECRET, manifestOriginal);

    const req = buildRequest({ ts: String(now), v1, requestId });
    // El caller pasa otro dataId → manifest recomputado distinto → fail.
    expect(verifyWebhookSignature({ req, dataId: 'pre-bbb', now: () => now })).toBe(false);
  });

  it('rechaza replay con ts > 5 min en el pasado', () => {
    const now = Date.now();
    const oldTs = now - 6 * 60_000; // 6 minutos atrás
    const dataId = 'pre-123';
    const requestId = 'req-abc';
    const manifest = `id:${dataId};request-id:${requestId};ts:${oldTs};`;
    const v1 = signManifest(SECRET, manifest);

    const req = buildRequest({ ts: String(oldTs), v1, requestId });
    expect(verifyWebhookSignature({ req, dataId, now: () => now })).toBe(false);
  });

  it('rechaza replay con ts > 5 min en el futuro', () => {
    const now = Date.now();
    const futureTs = now + 6 * 60_000;
    const dataId = 'pre-123';
    const requestId = 'req-abc';
    const manifest = `id:${dataId};request-id:${requestId};ts:${futureTs};`;
    const v1 = signManifest(SECRET, manifest);

    const req = buildRequest({ ts: String(futureTs), v1, requestId });
    expect(verifyWebhookSignature({ req, dataId, now: () => now })).toBe(false);
  });

  it('rechaza ts no numérico', () => {
    const dataId = 'pre-123';
    const requestId = 'req-abc';
    const manifest = `id:${dataId};request-id:${requestId};ts:not-a-number;`;
    const v1 = signManifest(SECRET, manifest);

    const req = buildRequest({ ts: 'not-a-number', v1, requestId });
    expect(verifyWebhookSignature({ req, dataId, now: () => Date.now() })).toBe(false);
  });

  it('rechaza header sin v1', () => {
    const dataId = 'pre-123';
    const req = new NextRequest('http://localhost/api/webhooks/mercadopago', {
      method: 'POST',
      headers: {
        'x-signature': `ts=${Date.now()}`,
        'x-request-id': 'req-abc',
      },
    });
    expect(verifyWebhookSignature({ req, dataId, now: () => Date.now() })).toBe(false);
  });
});
