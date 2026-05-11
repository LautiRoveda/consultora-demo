'use server';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

import { signupInputSchema } from './schema';

/**
 * Resultado de la server action de signup como discriminated union.
 *
 * **Patrón intencional:** la action NUNCA tira. El cliente patternmatchea sobre
 * `code` para mostrar el mensaje correcto. Errores reales (RPC falla, cleanup
 * falla) se loggean a Sentry via `logger.error` y devuelven `INTERNAL_ERROR`.
 *
 * Mismo pattern que `loginAction` (T-009). T-013 lo va a heredar también.
 */
export type SignupActionResult =
  | { ok: true; redirectTo: string }
  | {
      ok: false;
      code:
        | 'INVALID_INPUT'
        | 'EMAIL_ALREADY_REGISTERED'
        | 'WEAK_PASSWORD'
        | 'RATE_LIMITED'
        | 'INTERNAL_ERROR';
      message: string;
    };

/**
 * Crea una cuenta nueva: auth.users + consultoras + consultora_members (owner)
 * atómicamente. Si la RPC falla post-signUp, cleanup del auth.users con
 * service-role para evitar usuarios huérfanos sin tenant.
 *
 * Flujo:
 * 1. `supabase.auth.signUp({ email, password, emailRedirectTo })` crea el user
 *    en auth.users y dispara email de confirmación.
 * 2. RPC `create_consultora_and_owner(user_id, name)` crea consultora con
 *    trial 7d + slug auto-normalizado y membership 'owner', en una transacción.
 * 3. Si la RPC falla → service-role `auth.admin.deleteUser(user_id)` cleanup.
 * 4. Client redirige a `/check-email?email=...`.
 *
 * El user NO queda logueado tras signUp (email confirm pending). Cuando
 * confirma el email, llega a `/auth/callback` que hace exchangeCodeForSession
 * y redirige a `/login?confirmed=1`. Login real lo entrega T-013.
 */
export async function signupAction(input: unknown): Promise<SignupActionResult> {
  const parsed = signupInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Revisá los campos del formulario.',
    };
  }

  const { email, password, consultoraName } = parsed.data;
  const supabase = await createClient();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (signUpError) {
    const msg = signUpError.message ?? '';
    if (
      signUpError.code === 'user_already_exists' ||
      /already registered|already exists/i.test(msg)
    ) {
      return {
        ok: false,
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'Ya hay una cuenta con este email. Probá iniciar sesión.',
      };
    }
    if (/password|weak/i.test(msg)) {
      return {
        ok: false,
        code: 'WEAK_PASSWORD',
        message: 'Tu contraseña es muy débil. Probá una más larga o con números/símbolos.',
      };
    }
    if (signUpError.status === 429) {
      return {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Demasiados intentos. Esperá unos minutos y volvé a intentar.',
      };
    }
    logger.error(signUpError, 'signUp falló con error inesperado');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error creando tu cuenta. Reintentá en unos minutos.',
    };
  }

  const userId = signUpData.user?.id;
  if (!userId) {
    logger.error({ email }, 'signUp no devolvió user.id');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error creando tu cuenta. Reintentá en unos minutos.',
    };
  }

  const { error: rpcError } = await supabase.rpc('create_consultora_and_owner', {
    p_user_id: userId,
    p_name: consultoraName,
  });

  if (rpcError) {
    logger.error(
      { rpcError, userId, email },
      'create_consultora_and_owner falló — limpiando auth.users huérfano',
    );
    const admin = createServiceRoleClient();
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      logger.error(
        { delErr, userId },
        'cleanup admin.deleteUser falló — auth.users huérfano sin tenant',
      );
    }
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error creando tu cuenta. Reintentá en unos minutos.',
    };
  }

  logger.info({ userId, email }, 'signup_completed');

  return {
    ok: true,
    redirectTo: `/check-email?email=${encodeURIComponent(email)}`,
  };
}
