'use server';

import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import { updatePasswordInputSchema } from './schema';

/**
 * Resultado de `updatePasswordAction` como discriminated union.
 *
 * - `INVALID_INPUT`: Zod falla (raro — RHF cubre client-side).
 * - `NO_SESSION`: la sesión recovery expiró o fue invalidada. UX: pedir
 *   link nuevo desde `/recuperar-password`.
 * - `SAME_PASSWORD`: Supabase rechaza cuando la nueva = la actual (no
 *   siempre detectable según versión del SDK; matcheamos por message).
 * - `INTERNAL_ERROR`: cualquier otro. Loggeamos a Sentry.
 */
export type UpdatePasswordActionResult =
  | { ok: true; redirectTo: string }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'NO_SESSION' | 'SAME_PASSWORD' | 'INTERNAL_ERROR';
      message: string;
    };

/**
 * Cambia la contraseña del user logueado.
 *
 * Requiere sesión activa (recovery o normal — el SDK la valida igual).
 * Tras success, redirige a `/dashboard?reset=ok` para mostrar banner de
 * confirmación. La sesión recovery se promueve a sesión regular tras
 * `updateUser`, así que no hace falta volver a hacer signIn.
 */
export async function updatePasswordAction(input: unknown): Promise<UpdatePasswordActionResult> {
  const parsed = updatePasswordInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Revisá los campos.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: 'NO_SESSION',
      message: 'Tu sesión expiró. Pedí un link de recuperación nuevamente.',
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    const msg = error.message ?? '';
    if (/different|same.*password|must.*be.*different/i.test(msg)) {
      return {
        ok: false,
        code: 'SAME_PASSWORD',
        message: 'La nueva contraseña debe ser distinta a la anterior.',
      };
    }
    logger.error({ error, userId: user.id }, 'updateUser password falló');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error actualizando tu contraseña. Reintentá en unos minutos.',
    };
  }

  logger.info({ userId: user.id }, 'password_updated');
  return { ok: true, redirectTo: '/dashboard?reset=ok' };
}
