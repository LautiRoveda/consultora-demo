'use server';

import { headers } from 'next/headers';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';
import { getClientIpFromHeaders, normalizeEmailKey } from '@/shared/security/identify';
import { getRateLimiter } from '@/shared/security/rate-limit';
import { createClient } from '@/shared/supabase/server';

import { recoverPasswordInputSchema } from './schema';

// T-081 · Rate limit recovery: multi-dim IP + email.
// IP: 3/1h — recovery raro, spam mitigation.
// Email: 1/1h — anti-enumeration AGRESIVO. Recovery dispara email + el user
// no debería pedir reset 2x en 1h sin haber recibido el primero.
const recoverIpLimiter = getRateLimiter({
  identifier: 'recover-password-ip',
  limit: 3,
  window: '1 h',
});
const recoverEmailLimiter = getRateLimiter({
  identifier: 'recover-password-email',
  limit: 1,
  window: '1 h',
});

/**
 * Resultado de `recoverPasswordAction` como discriminated union.
 *
 * Anti-enumeration: la action devuelve `ok: true` con el MISMO mensaje
 * genérico tanto si el email existe como si no existe. Sólo `RATE_LIMITED`
 * (per-IP, no per-email — no leakea cuentas específicas) se distingue.
 */
export type RecoverPasswordActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      code: 'INVALID_INPUT';
      message: string;
    }
  | {
      // T-081: variante con retryAfterSeconds type-safe.
      ok: false;
      code: 'RATE_LIMITED';
      message: string;
      retryAfterSeconds: number;
    };

/**
 * Envía un email con link para resetear la contraseña.
 *
 * Flujo:
 * 1. `resetPasswordForEmail(email, { redirectTo: /auth/callback?next=/cambiar-password })`
 *    → Supabase envía email con `{{ .ConfirmationURL }}` apuntando al callback.
 * 2. User clickea → `/auth/callback?code=...&next=/cambiar-password&from=recovery`.
 * 3. Callback hace `exchangeCodeForSession` → sesión activa → redirect a `/cambiar-password`.
 * 4. User llena nueva password → `updatePasswordAction` → `/dashboard?reset=ok`.
 */
export async function recoverPasswordAction(input: unknown): Promise<RecoverPasswordActionResult> {
  const parsed = recoverPasswordInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Ingresá un email válido.',
    };
  }

  const { email } = parsed.data;

  // T-081: rate limit multi-dim (IP + email) post-Zod, pre-Supabase.
  const ip = getClientIpFromHeaders(await headers());
  const emailKey = normalizeEmailKey(email);
  const [ipResult, emailResult] = await Promise.all([
    recoverIpLimiter.limit(ip),
    recoverEmailLimiter.limit(emailKey),
  ]);
  if (!ipResult.success || !emailResult.success) {
    const retryAfterSeconds = Math.max(ipResult.retryAfterSeconds, emailResult.retryAfterSeconds);
    logger.warn(
      {
        ip,
        email,
        ipExceeded: !ipResult.success,
        emailExceeded: !emailResult.success,
        code: 'RATE_LIMITED',
      },
      'recover_password_rate_limited',
    );
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: `Demasiados intentos. Reintentá en ${retryAfterSeconds}s.`,
      retryAfterSeconds,
    };
  }

  const supabase = await createClient();

  const genericSuccessMessage = `Si el email ${email} está registrado, te enviamos un link para resetear la contraseña.`;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/cambiar-password&from=recovery`,
  });

  if (error) {
    if (error.status === 429) {
      // Supabase Auth rate limit interno (separado del nuestro de T-081).
      logger.warn({ email, code: 'RATE_LIMITED', source: 'supabase' }, 'recover_password_failed');
      return {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Demasiados intentos. Esperá unos minutos y volvé a intentar.',
        retryAfterSeconds: 60,
      };
    }
    // Anti-enumeration: cualquier otro error (user_not_found, etc.) → mensaje
    // genérico para no leakar status de cuentas. Loggeamos `info` (no warn/error)
    // porque es comportamiento esperado, no fallo nuestro.
    logger.info({ email, supabaseCode: error.code }, 'recover_password_silent_pass');
    return { ok: true, message: genericSuccessMessage };
  }

  logger.info({ email }, 'recover_password_requested');
  return { ok: true, message: genericSuccessMessage };
}
