import 'server-only';

import { Resend } from 'resend';

import { env } from '@/env';

/**
 * T-031 · Cliente Resend para Server Actions / Route Handlers.
 *
 * **Server-only.** El `server-only` del tope asegura que un Client Component
 * que importe este modulo rompe el build de Next.js. Defensa en profundidad
 * contra leak de `RESEND_API_KEY` al bundle del cliente.
 *
 * Singleton lazy (patron T-020 con anthropic.ts): la primera invocacion
 * instancia, las siguientes reusan. Resend SDK es internamente thread-safe.
 */
let cachedClient: Resend | null = null;

export function getResendClient(): Resend {
  if (!cachedClient) {
    cachedClient = new Resend(env.RESEND_API_KEY);
  }
  return cachedClient;
}
