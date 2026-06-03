import 'server-only';

import type { CurrentConsultora } from '@/shared/auth/types';
import type { createClient } from '@/shared/supabase/server';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';

export type OwnerContext = {
  userId: string;
  consultoraId: string;
  role: 'owner' | 'member';
  /** CurrentConsultora completa — permite encadenar requireBillingAccess sin un 2º fetch. */
  consultora: CurrentConsultora;
};

export type RequireOwnerFailure = {
  ok: false;
  code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'FORBIDDEN_NOT_OWNER';
  message: string;
};

/**
 * Auth + owner-only gate compartido. Config sensible (catálogos del owner: EPP
 * catálogo, Checklists templates) sólo mutable por owners. La RLS del schema
 * permite any-member; el check está acá a nivel app como defense-in-depth (algunas
 * RPCs lo reafirman con `is_owner_of_consultora`).
 *
 * El `ctx` es superset (`consultoraId`/`role` + la `CurrentConsultora` completa)
 * para que los consumidores que necesitan billing encadenen `requireBillingAccess`
 * con `ctx.consultora` sin un segundo `getCurrentConsultora`.
 */
export async function requireOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ ok: true; ctx: OwnerContext } | RequireOwnerFailure> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'No tenés una consultora asociada.',
    };
  }

  if (consultora.role !== 'owner') {
    return {
      ok: false,
      code: 'FORBIDDEN_NOT_OWNER',
      message: 'Solo el owner de la consultora puede realizar esta acción.',
    };
  }

  return {
    ok: true,
    ctx: { userId: user.id, consultoraId: consultora.id, role: consultora.role, consultora },
  };
}
