import 'server-only';

import { timingSafeEqual } from 'node:crypto';

/**
 * C1 audit · constant-time string compare.
 *
 * `===` y `!==` abortan en el primer byte distinto -> timing leak del prefix
 * correcto del secret a un atacante remoto que mida la latencia. timingSafeEqual
 * recorre TODOS los bytes en tiempo constante (siempre que los buffers tengan la
 * misma length).
 *
 * Length check ANTES de invocar timingSafeEqual: la función exige buffers del
 * mismo size, si no tira TypeError. Esto SÍ leaka la length del secret, pero la
 * length es info pública (min length fijada por cada secret en env.ts).
 *
 * Reusable cross-webhook: Telegram, dispatch-reminder, billing-notifications.
 */
export function constantTimeEqual(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}
