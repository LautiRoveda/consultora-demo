/**
 * T-034 · Helpers para Route Handlers subscribe/unsubscribe.
 *
 * Sin `server-only` (Zod schema lo consume el client al validar el shape
 * antes del POST, opcional).
 */

import type { Database } from '@/shared/supabase/types';
import type { PushSubscriptionInput } from './types';

import { PushSubscriptionInputSchema } from './types';

type PushSubInsert = Database['public']['Tables']['push_subscriptions']['Insert'];

/**
 * Parsea el body del POST /api/push/subscribe.
 * Wrapper sobre el Zod schema con shape de retorno discriminated.
 */
export function extractSubscriptionFromBody(
  body: unknown,
): { ok: true; data: PushSubscriptionInput } | { ok: false; issues: string[] } {
  const parsed = PushSubscriptionInputSchema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  };
}

/**
 * Construye el row del DB INSERT/UPSERT desde el shape del browser.
 * userAgent puede ser null (header absent en el request).
 *
 * Incluimos last_seen_at explícito para que el UPSERT lo actualice en re-subscribe
 * (sino UPDATE preserva el valor previo, perdiendo el tracking de actividad).
 */
export function buildSubscriptionDbRow(
  sub: PushSubscriptionInput,
  userId: string,
  userAgent: string | null,
): PushSubInsert {
  return {
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh_key: sub.keys.p256dh,
    auth_key: sub.keys.auth,
    user_agent: userAgent,
    last_seen_at: new Date().toISOString(),
  };
}
