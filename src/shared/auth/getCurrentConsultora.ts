import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CurrentConsultora } from './types';

import { logger } from '@/shared/observability/logger';

/**
 * Decodifica el payload de un JWT (segmento del medio).
 *
 * NO valida la firma — el server de Supabase ya lo hizo cuando consumió la
 * cookie; acá sólo leemos los claims que inyectó `custom_access_token_hook`
 * (T-016). Si el JWT está malformado, devuelve `null` — el helper cae al
 * fallback por `consultora_members`.
 */
function decodeJwtClaims(jwt: string): {
  consultora_id: string | null;
  consultora_role: string | null;
} | null {
  const segments = jwt.split('.');
  if (segments.length !== 3) return null;
  try {
    const b64url = segments[1] ?? '';
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    const payload = JSON.parse(json) as {
      app_metadata?: { consultora_id?: unknown; consultora_role?: unknown };
    };
    const appMetadata = payload.app_metadata ?? {};
    return {
      consultora_id:
        typeof appMetadata.consultora_id === 'string' ? appMetadata.consultora_id : null,
      consultora_role:
        typeof appMetadata.consultora_role === 'string' ? appMetadata.consultora_role : null,
    };
  } catch {
    return null;
  }
}

/**
 * Obtiene la consultora del usuario logueado, con fast-path por JWT claim
 * (T-016) y fallback a `consultora_members` para sesiones pre-hook.
 *
 * Llamado desde `(app)/layout.tsx` en cada navegación dentro del shell.
 *
 * @param supabase Server client con la sesión del request actual.
 * @param userId   `user.id` ya validado por `getUser()` aguas arriba.
 *                 **Sólo se usa en el fallback path** — el path por claim lo
 *                 extrae del JWT directamente. Lo recibimos como parámetro
 *                 para evitar un segundo `getUser()` (round-trip a auth).
 *
 * @returns `CurrentConsultora` si el user tiene membership activo. `null` si:
 *   - el user no tiene membership,
 *   - la consultora del claim está archivada/borrada y tampoco hay fallback,
 *   - hay error de DB (loggeado a Sentry).
 *
 * No tira. El layout decide el redirect.
 */
export async function getCurrentConsultora(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<CurrentConsultora | null> {
  // 1. Fast-path: leer claims del JWT (inyectados por custom_access_token_hook
  //    en T-016). `session.user.app_metadata` NO los trae — esa columna es
  //    `auth.users.raw_app_meta_data`, persistida. El hook actúa solo en el
  //    token, así que hay que decodearlo.
  const { data: sessionRes } = await supabase.auth.getSession();
  const accessToken = sessionRes.session?.access_token ?? null;
  const claims = accessToken ? decodeJwtClaims(accessToken) : null;
  const claimConsultoraId = claims?.consultora_id ?? null;
  const claimRole: 'owner' | 'member' | null =
    claims?.consultora_role === 'owner' || claims?.consultora_role === 'member'
      ? claims.consultora_role
      : null;

  if (claimConsultoraId && claimRole) {
    const { data, error } = await supabase
      .from('consultoras')
      .select(
        'id, name, slug, plan_tier, trial_ends_at, logo_storage_path, auto_create_event_on_sign',
      )
      .eq('id', claimConsultoraId)
      .maybeSingle();

    if (error) {
      logger.error(
        { err: error, userId, claimConsultoraId },
        'getCurrentConsultora: claim path query failed',
      );
      return null;
    }

    if (data) {
      return {
        id: data.id,
        name: data.name,
        slug: data.slug,
        planTier: data.plan_tier,
        trialEndsAt: data.trial_ends_at,
        role: claimRole,
        logoStoragePath: data.logo_storage_path,
        autoCreateEventOnSign: data.auto_create_event_on_sign,
      };
    }

    // Claim válido pero la consultora ya no existe (archivada/borrada).
    // Caer al fallback por si el user tiene un membership a otra consultora.
    logger.warn(
      { userId, claimConsultoraId },
      'getCurrentConsultora: claim apunta a consultora inexistente, intentando fallback',
    );
  }

  // 2. Fallback: query a consultora_members (sesión pre-T-016 o claim stale).
  const { data, error } = await supabase
    .from('consultora_members')
    .select(
      'role, consultoras(id, name, slug, plan_tier, trial_ends_at, logo_storage_path, auto_create_event_on_sign)',
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, userId }, 'getCurrentConsultora: fallback query failed');
    return null;
  }

  if (!data?.consultoras) {
    logger.warn({ userId }, 'getCurrentConsultora: user sin membership');
    return null;
  }

  const role: 'owner' | 'member' = data.role === 'owner' ? 'owner' : 'member';

  return {
    id: data.consultoras.id,
    name: data.consultoras.name,
    slug: data.consultoras.slug,
    planTier: data.consultoras.plan_tier,
    trialEndsAt: data.consultoras.trial_ends_at,
    role,
    logoStoragePath: data.consultoras.logo_storage_path,
    autoCreateEventOnSign: data.consultoras.auto_create_event_on_sign,
  };
}
