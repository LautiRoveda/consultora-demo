import 'server-only';

import type { OwnerContext } from '@/shared/auth/requireOwner';
import type { CurrentConsultora } from '@/shared/auth/types';
import type { BillingGateReason } from '@/shared/billing/access';
import type { createClient } from '@/shared/supabase/server';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireOwner } from '@/shared/auth/requireOwner';
import { requireBillingAccess } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { logger } from '@/shared/observability/logger';

/**
 * Preambles de auth + billing reusables (T-060).
 *
 * Por qué acá y no inline en cada módulo: el `requireOwnerWithBilling` original
 * vive LOCAL en checklists/actions.ts. La lesson **T-115** señala que
 * `requireBillingAccess` (→ `getActiveSubscription`) puede TIRAR ante un error de
 * DB; sin try/catch el reject queda sin manejar y el action explota con un 500
 * en vez de un fallo de dominio. Estos helpers envuelven el billing en try/catch
 * y mapean a `INTERNAL_ERROR`. Dos niveles:
 *  - `requireMemberWithBilling`: cualquier member (relevar/responder/adjuntar).
 *  - `requireOwnerWithBilling`: owner-only (cerrar/firmar/anular).
 */

export type MemberContext = {
  userId: string;
  consultoraId: string;
  role: 'owner' | 'member';
  /** CurrentConsultora completa (evita un 2º fetch para billing/branding). */
  consultora: CurrentConsultora;
};

export type AccessFailure =
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'FORBIDDEN_NOT_OWNER' | 'INTERNAL_ERROR';
      message: string;
    }
  | { ok: false; code: 'BILLING_GATED'; reason: BillingGateReason; message: string };

/**
 * Envuelve `requireBillingAccess` en try/catch (T-115). Devuelve el fallo
 * (BILLING_GATED o INTERNAL_ERROR) o `null` si la consultora tiene acceso.
 */
async function billingGate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  consultora: CurrentConsultora,
  ctxForLog: { userId: string; consultoraId: string },
): Promise<AccessFailure | null> {
  try {
    const billing = await requireBillingAccess(supabase, consultora);
    if (!billing.ok) {
      logger.info({ ...ctxForLog, reason: billing.reason }, 'with-billing: billing gated');
      return {
        ok: false,
        code: 'BILLING_GATED',
        reason: billing.reason,
        message: getGateMessage(billing.reason),
      };
    }
    return null;
  } catch (err) {
    logger.error({ err, ...ctxForLog }, 'with-billing: requireBillingAccess threw');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo validar la suscripción. Reintentá en unos minutos.',
    };
  }
}

/** Auth + consultora (cualquier rol) + billing gate. */
export async function requireMemberWithBilling(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ ok: true; ctx: MemberContext } | AccessFailure> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return { ok: false, code: 'NO_CONSULTORA', message: 'No tenés una consultora asociada.' };
  }

  const gated = await billingGate(supabase, consultora, {
    userId: user.id,
    consultoraId: consultora.id,
  });
  if (gated) return gated;

  return {
    ok: true,
    ctx: { userId: user.id, consultoraId: consultora.id, role: consultora.role, consultora },
  };
}

/** Auth + owner-only gate + billing gate. */
export async function requireOwnerWithBilling(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ ok: true; ctx: OwnerContext } | AccessFailure> {
  const auth = await requireOwner(supabase);
  if (!auth.ok) return auth;

  const gated = await billingGate(supabase, auth.ctx.consultora, {
    userId: auth.ctx.userId,
    consultoraId: auth.ctx.consultoraId,
  });
  if (gated) return gated;

  return { ok: true, ctx: auth.ctx };
}
