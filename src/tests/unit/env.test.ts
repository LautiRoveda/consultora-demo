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
});

describe('envSchema', () => {
  const validInput = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  };

  it('acepta vars válidas', () => {
    const result = envSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('rechaza URL inválida', () => {
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

  it('rechaza objeto sin las claves requeridas', () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
