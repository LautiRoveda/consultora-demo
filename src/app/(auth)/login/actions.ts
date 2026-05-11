'use server';

import { loginInputSchema } from './schema';

/**
 * Resultado de la server action como discriminated union.
 *
 * **Patrón intencional:** la action NUNCA tira (no hay `throw`). El cliente
 * patternmatchea sobre `code` para decidir qué hacer. Esto evita:
 *
 * - Que Next.js serialice/deserialice una `Error` perdiendo la clase concreta.
 * - Que errores intencionales lleguen a Sentry como noise (instrumentation
 *   `onRequestError` solo capta unhandled).
 *
 * En T-012 (auth real con Supabase), esta misma firma se mantiene:
 * - `{ ok: true }` cuando `auth.signInWithPassword` devuelve session válida.
 * - `{ ok: false, code: 'INVALID_CREDENTIALS', ... }` cuando falla.
 * - `{ ok: false, code: 'INVALID_INPUT', ... }` ante input no parseable.
 */
export type LoginActionResult =
  | { ok: true }
  | {
      ok: false;
      code: 'AUTH_NOT_IMPLEMENTED' | 'INVALID_INPUT';
      message: string;
    };

/**
 * Stub de login para T-009 — solo UI funcional, sin backend de auth.
 *
 * Siempre devuelve `AUTH_NOT_IMPLEMENTED` con un mensaje friendly. T-012
 * reemplaza esta implementación por una real contra Supabase Auth (manteniendo
 * la misma firma de retorno para no romper el cliente).
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

  // Simulación mínima de I/O para que el botón muestre estado "cargando"
  // un instante (mejor UX que un retorno instantáneo).
  await new Promise((resolve) => setTimeout(resolve, 400));

  return {
    ok: false,
    code: 'AUTH_NOT_IMPLEMENTED',
    message: 'Login real llega en T-013. Por ahora podés crear tu cuenta.',
  };
}
