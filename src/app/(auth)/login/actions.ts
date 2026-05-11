'use server';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import { loginInputSchema, magicLinkInputSchema } from './schema';

/**
 * Resultados como discriminated unions: la action NUNCA tira. El cliente
 * patternmatchea sobre `code` para decidir UX. Errores reales se loggean
 * a Sentry via `logger.error` y devuelven `INTERNAL_ERROR`.
 *
 * Mismo patrón que signupAction (T-012).
 */
export type LoginActionResult =
  | { ok: true; redirectTo: string }
  | {
      ok: false;
      code:
        | 'INVALID_INPUT'
        | 'INVALID_CREDENTIALS'
        | 'EMAIL_NOT_CONFIRMED'
        | 'RATE_LIMITED'
        | 'INTERNAL_ERROR';
      message: string;
    };

export type MagicLinkActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'RATE_LIMITED' | 'INTERNAL_ERROR';
      message: string;
    };

/**
 * Login con email + password.
 *
 * `signInWithPassword` setea el cookie de sesión via el cookie writer del
 * server client. El cliente recibe `{ ok: true, redirectTo: '/dashboard' }`
 * y hace `router.push(redirectTo)` — la próxima request a /dashboard incluye
 * el cookie y `getUser()` devuelve el user.
 *
 * Códigos:
 * - `INVALID_INPUT`: Zod falla (raro — RHF cubre client-side).
 * - `INVALID_CREDENTIALS`: password incorrecta o user inexistente.
 *   Supabase devuelve el mismo error para ambos casos por seguridad — no
 *   leakeamos si el email existe.
 * - `EMAIL_NOT_CONFIRMED`: cuenta creada pero email no confirmado.
 * - `RATE_LIMITED`: Supabase 429.
 * - `INTERNAL_ERROR`: cualquier otro fallo. Loggeamos a Sentry.
 */
export async function loginAction(input: unknown): Promise<LoginActionResult> {
  const parsed = loginInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Revisá los campos del formulario.',
    };
  }

  const { email, password } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = error.message ?? '';
    if (
      error.code === 'invalid_credentials' ||
      /invalid login credentials|invalid_credentials/i.test(msg)
    ) {
      logger.warn({ email, code: 'INVALID_CREDENTIALS' }, 'signin_failed');
      return {
        ok: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Email o contraseña incorrectos.',
      };
    }
    if (
      error.code === 'email_not_confirmed' ||
      /email not confirmed|email_not_confirmed/i.test(msg)
    ) {
      logger.warn({ email, code: 'EMAIL_NOT_CONFIRMED' }, 'signin_failed');
      return {
        ok: false,
        code: 'EMAIL_NOT_CONFIRMED',
        message: 'Tu cuenta no está confirmada. Revisá tu email.',
      };
    }
    if (error.status === 429) {
      logger.warn({ email, code: 'RATE_LIMITED' }, 'signin_failed');
      return {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Demasiados intentos. Esperá unos minutos y volvé a intentar.',
      };
    }
    logger.error({ error, email }, 'signInWithPassword falló con error inesperado');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error iniciando sesión. Reintentá en unos minutos.',
    };
  }

  logger.info({ userId: data.user?.id, email, method: 'password' }, 'signin_completed');

  return { ok: true, redirectTo: '/dashboard' };
}

/**
 * Magic link: envía un OTP por email que linkea a `/auth/callback?next=/dashboard`.
 *
 * `shouldCreateUser: false` es crítico — magic link NO crea cuentas. El flow
 * de creación de cuenta vive en `/signup` (T-012, atomic con RPC). Sin este
 * flag, `signInWithOtp` crearía un user sin consultora → estado inconsistente.
 *
 * **Privacidad:** si el email no existe, Supabase devuelve OK (200) sin enviar
 * email — comportamiento por seguridad para no leakar existencia de cuentas.
 * Nuestra action devuelve `{ ok: true, message: 'Te enviamos un link' }` igual.
 * El user nunca recibe email pero no le decimos por qué.
 */
export async function magicLinkAction(input: unknown): Promise<MagicLinkActionResult> {
  const parsed = magicLinkInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Ingresá un email válido.',
    };
  }

  const { email } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/dashboard&from=magic_link`,
    },
  });

  // Respuesta genérica de "te enviamos el link" — el mismo string para success
  // real y para casos donde el email no existe o no está confirmado. Anti
  // enumeration: el atacante no puede distinguir desde la UI si una cuenta
  // existe o no.
  const genericSuccessMessage = `Te enviamos un link a ${email}. Revisá tu inbox.`;

  if (error) {
    if (error.status === 429) {
      logger.warn({ email, code: 'RATE_LIMITED' }, 'magic_link_failed');
      return {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Demasiados intentos. Esperá unos minutos.',
      };
    }

    // Anti-enumeration: si Supabase indica que el user no existe (por
    // `shouldCreateUser: false`) o que el email no está confirmado, devolver
    // el MISMO mensaje genérico que el success path. Loggeamos `info` (no
    // `warn`/`error`) porque no es un error nuestro — es comportamiento
    // esperado para no leakar la existencia de cuentas.
    const msg = error.message ?? '';
    const isUserNotFoundOrUnconfirmed =
      error.code === 'user_not_found' ||
      error.code === 'otp_disabled' ||
      /user not found|signups? not allowed|email.*not.*confirmed/i.test(msg);

    if (isUserNotFoundOrUnconfirmed) {
      logger.info(
        { email, supabaseCode: error.code },
        'magic_link_requested_for_unknown_or_unconfirmed_email',
      );
      return { ok: true, message: genericSuccessMessage };
    }

    logger.error({ error, email }, 'signInWithOtp falló con error inesperado');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error enviando el link. Reintentá en unos minutos.',
    };
  }

  logger.info({ email, method: 'magic_link' }, 'magic_link_requested');

  return { ok: true, message: genericSuccessMessage };
}
