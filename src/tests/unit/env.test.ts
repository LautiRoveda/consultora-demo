import { describe, expect, it, vi } from 'vitest';

import { envSchema } from '@/env';

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
});
