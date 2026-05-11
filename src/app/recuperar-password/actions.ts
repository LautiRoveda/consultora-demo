'use server';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import { recoverPasswordInputSchema } from './schema';

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
      code: 'INVALID_INPUT' | 'RATE_LIMITED';
      message: string;
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
  const supabase = await createClient();

  const genericSuccessMessage = `Si el email ${email} está registrado, te enviamos un link para resetear la contraseña.`;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/cambiar-password&from=recovery`,
  });

  if (error) {
    if (error.status === 429) {
      logger.warn({ email, code: 'RATE_LIMITED' }, 'recover_password_failed');
      return {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Demasiados intentos. Esperá unos minutos y volvé a intentar.',
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
