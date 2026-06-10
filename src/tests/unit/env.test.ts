import { describe, expect, it, vi } from 'vitest';

import { envSchema, shouldWarnMissingRateLimit } from '@/env';

// Vitest hoist `vi.mock(...)` automáticamente al tope del archivo en runtime,
// aunque visualmente quede después de los imports por el plugin sort-imports.
//
// `src/env.ts` empieza con `import 'server-only'`. En Node (Vitest unit) el
// paquete tira si lo importan; el mock lo neutraliza.
vi.mock('server-only', () => ({}));

// `src/env.ts` ejecuta `envSchema.safeParse(process.env)` al cargar el módulo
// y tira si las vars no están seteadas. `vi.hoisted` corre antes de los
// imports estáticos, garantizando que `@/env` cargue con vars válidas.
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
  // T-033 — vars Telegram required.
  process.env.TELEGRAM_BOT_TOKEN = 'hoisted-tg-token-40-chars-min-aaaaaaaaaaaaaaaa';
  process.env.TELEGRAM_BOT_USERNAME = 'hoisted_bot';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hoisted-tg-webhook-secret-32-chars-aaaa';
  // T-034 — VAPID required.
  process.env.VAPID_PRIVATE_KEY = 'hoisted-vapid-private-key-44-chars-b64url-aaa';
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY =
    'hoisted-vapid-public-key-88-chars-b64url-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  // T-070 — pricing required.
  process.env.ARS_PRICE_MONTHLY = '3000000';
  // T-071 — Mercado Pago required.
  process.env.MP_ACCESS_TOKEN = 'hoisted-mp-access-token-40-chars-minimum-aaaaa';
  process.env.MP_WEBHOOK_SECRET = 'hoisted-mp-webhook-secret-32-chars-aaaaa';
});

describe('envSchema', () => {
  const validInput = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    NEXT_PUBLIC_SENTRY_DSN: 'https://abc@o0.ingest.sentry.io/0',
    SENTRY_ORG: 'lautaro-96',
    SENTRY_PROJECT: 'consultora-demo',
    ANTHROPIC_API_KEY: 'anthropic-key',
    RESEND_API_KEY: 'resend-key',
    RESEND_FROM_ADDRESS: 'reminders@example.com',
    INTERNAL_CRON_SECRET: 'cron-secret-32-chars-min-aaaaaaaaaa',
    TELEGRAM_BOT_TOKEN: '1234567890:AAH-some-bot-token-35char-hash-xx',
    TELEGRAM_BOT_USERNAME: 'consultora_demo_bot',
    TELEGRAM_WEBHOOK_SECRET: 'tg-webhook-secret-32-chars-aaaaaaa',
    VAPID_PRIVATE_KEY: 'valid-vapid-private-key-44-chars-b64url-aaa',
    NEXT_PUBLIC_VAPID_PUBLIC_KEY:
      'valid-vapid-public-key-88-chars-b64url-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ARS_PRICE_MONTHLY: '3000000',
    MP_ACCESS_TOKEN: 'valid-mp-access-token-40-chars-minimum-aaaaa',
    MP_WEBHOOK_SECRET: 'valid-mp-webhook-secret-32-chars-aaaaa',
  };

  it('acepta vars válidas', () => {
    const result = envSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('rechaza URL inválida en Supabase URL', () => {
    const result = envSchema.safeParse({
      ...validInput,
      NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza anon key vacía', () => {
    const result = envSchema.safeParse({
      ...validInput,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza service role key vacía', () => {
    const result = envSchema.safeParse({
      ...validInput,
      SUPABASE_SERVICE_ROLE_KEY: '',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza Sentry DSN no-URL', () => {
    const result = envSchema.safeParse({
      ...validInput,
      NEXT_PUBLIC_SENTRY_DSN: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza SENTRY_ORG vacío', () => {
    const result = envSchema.safeParse({
      ...validInput,
      SENTRY_ORG: '',
    });
    expect(result.success).toBe(false);
  });

  it('acepta SENTRY_FORCE_ENABLE ausente (es opcional)', () => {
    const result = envSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('acepta SENTRY_FORCE_ENABLE seteado a "true"', () => {
    const result = envSchema.safeParse({
      ...validInput,
      SENTRY_FORCE_ENABLE: 'true',
    });
    expect(result.success).toBe(true);
  });

  it('NEXT_PUBLIC_SITE_URL tiene default si se omite', () => {
    const result = envSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_SITE_URL).toBe('https://consultorademo.com.ar');
    }
  });

  it('NEXT_PUBLIC_SITE_URL acepta override válido', () => {
    const result = envSchema.safeParse({
      ...validInput,
      NEXT_PUBLIC_SITE_URL: 'https://staging.consultorademo.com.ar',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_SITE_URL).toBe('https://staging.consultorademo.com.ar');
    }
  });

  it('NEXT_PUBLIC_SITE_URL rechaza valor no-URL', () => {
    const result = envSchema.safeParse({
      ...validInput,
      NEXT_PUBLIC_SITE_URL: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza objeto sin las claves requeridas', () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rechaza ANTHROPIC_API_KEY vacía (T-020)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      ANTHROPIC_API_KEY: '',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza RESEND_API_KEY vacía (T-031)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      RESEND_API_KEY: '',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza RESEND_FROM_ADDRESS no-email (T-031)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      RESEND_FROM_ADDRESS: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza INTERNAL_CRON_SECRET < 32 chars (T-031)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      INTERNAL_CRON_SECRET: 'too-short',
    });
    expect(result.success).toBe(false);
  });

  it('RESEND_REPLY_TO_ADDRESS tiene default si se omite (T-031)', () => {
    const result = envSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.RESEND_REPLY_TO_ADDRESS).toBe(
        'noreply@mail.consultora-demo.test-ia.cloud',
      );
    }
  });

  it('RESEND_REPLY_TO_ADDRESS acepta override válido (T-031)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      RESEND_REPLY_TO_ADDRESS: 'soporte@consultora-demo.test-ia.cloud',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.RESEND_REPLY_TO_ADDRESS).toBe('soporte@consultora-demo.test-ia.cloud');
    }
  });

  it('RESEND_REPLY_TO_ADDRESS rechaza no-email (T-031)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      RESEND_REPLY_TO_ADDRESS: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza TELEGRAM_BOT_TOKEN < 40 chars (T-033)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      TELEGRAM_BOT_TOKEN: 'too-short',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza TELEGRAM_BOT_USERNAME con @ inicial (T-033)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      TELEGRAM_BOT_USERNAME: '@my_bot',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza TELEGRAM_BOT_USERNAME con guión (T-033)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      TELEGRAM_BOT_USERNAME: 'my-bot',
    });
    expect(result.success).toBe(false);
  });

  it('acepta TELEGRAM_BOT_USERNAME con underscore y dígitos (T-033)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      TELEGRAM_BOT_USERNAME: 'consultora_demo_2_bot',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza TELEGRAM_WEBHOOK_SECRET < 32 chars (T-033)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      TELEGRAM_WEBHOOK_SECRET: 'too-short',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza VAPID_PRIVATE_KEY < 40 chars (T-034)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      VAPID_PRIVATE_KEY: 'too-short',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza NEXT_PUBLIC_VAPID_PUBLIC_KEY < 80 chars (T-034)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'too-short-public-key',
    });
    expect(result.success).toBe(false);
  });

  it('VAPID_SUBJECT tiene default mailto: si se omite (T-034)', () => {
    const result = envSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.VAPID_SUBJECT).toBe('mailto:noreply@mail.consultora-demo.test-ia.cloud');
    }
  });

  it('VAPID_SUBJECT acepta override mailto: válido (T-034)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      VAPID_SUBJECT: 'mailto:contacto@consultora-demo.test-ia.cloud',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.VAPID_SUBJECT).toBe('mailto:contacto@consultora-demo.test-ia.cloud');
    }
  });

  it('VAPID_SUBJECT acepta https:// (T-034)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      VAPID_SUBJECT: 'https://consultora-demo.test-ia.cloud',
    });
    expect(result.success).toBe(true);
  });

  it('VAPID_SUBJECT rechaza formato sin mailto:|https:// (T-034)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      VAPID_SUBJECT: 'lautaro@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza ARS_PRICE_MONTHLY con decimales (T-070)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      ARS_PRICE_MONTHLY: '30000.50',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza ARS_PRICE_MONTHLY vacío (T-070)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      ARS_PRICE_MONTHLY: '',
    });
    expect(result.success).toBe(false);
  });

  it('acepta ARS_PRICE_MONTHLY entero como string (T-070)', () => {
    const result = envSchema.safeParse({
      ...validInput,
      ARS_PRICE_MONTHLY: '5000000',
    });
    expect(result.success).toBe(true);
  });
});

// T-135 (L-3) · La condición del warn de boot es función pura — el bloque
// `if + console.warn` de env.ts es glue trivial (mismo molde que los warns de
// BILLING_GATE_DISABLED / MP_TEST_PAYER_EMAIL); lo que protege es la condición.
describe('shouldWarnMissingRateLimit (T-135 L-3)', () => {
  const upstashPresent = {
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
  };

  it('true en production con ambas envs ausentes (rate limits caen al noop sin señal)', () => {
    expect(shouldWarnMissingRateLimit({}, 'production')).toBe(true);
  });

  it('true en production con solo el TOKEN presente (getRedisClient exige ambas)', () => {
    expect(
      shouldWarnMissingRateLimit({ UPSTASH_REDIS_REST_TOKEN: 'upstash-token' }, 'production'),
    ).toBe(true);
  });

  it('true en production con solo la URL presente', () => {
    expect(
      shouldWarnMissingRateLimit(
        { UPSTASH_REDIS_REST_URL: 'https://example.upstash.io' },
        'production',
      ),
    ).toBe(true);
  });

  it('false en production con ambas presentes (configuración correcta, sin ruido)', () => {
    expect(shouldWarnMissingRateLimit(upstashPresent, 'production')).toBe(false);
  });

  it('false en development sin envs (dev local sin Upstash es el diseño de T-081)', () => {
    expect(shouldWarnMissingRateLimit({}, 'development')).toBe(false);
  });

  it('false con NODE_ENV undefined sin envs', () => {
    expect(shouldWarnMissingRateLimit({}, undefined)).toBe(false);
  });
});
