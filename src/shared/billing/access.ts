import 'server-only';

import type { SuscripcionRow } from '@/app/(app)/settings/billing/queries';
import type { CurrentConsultora } from '@/shared/auth/types';
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getActiveSubscription } from '@/app/(app)/settings/billing/queries';
import { env } from '@/env';

/**
 * T-073 · Trial gate enforcement.
 *
 * Server-side helper que decide si una consultora puede ejecutar acciones de
 * CREATE/EXPORT/GENERATE. NO bloquea READ/UPDATE/DELETE (decisión pre-launch).
 *
 * Estados que disparan el gate:
 *   - plan='trial' + trial_hasta < now() (trial vencido sin pago).
 *   - estado_suscripcion='expirada'.
 *   - estado_suscripcion='cancelada' + (cancelar_en < now() O cancelar_en NULL)
 *     (período ya pasó / churn por falta de pago sin gracia pendiente — T-124).
 *
 * Estados OK:
 *   - plan='trial' + trial_hasta >= now().
 *   - estado_suscripcion='activa'.
 *   - estado_suscripcion='pendiente_autorizacion' (MP procesando alta).
 *   - estado_suscripcion='morosa' (grace period, MP reintenta).
 *   - estado_suscripcion='cancelada' + cancelar_en >= now() (activa hasta fin
 *     del período pagado).
 *
 * Bypass dev: `env.BILLING_GATE_DISABLED === 'true'` override-all → ok=true.
 */
export type BillingGateReason = 'TRIAL_EXPIRED' | 'SUBSCRIPTION_EXPIRED' | 'SUBSCRIPTION_CANCELLED';

export type BillingStatus = { ok: true } | { ok: false; reason: BillingGateReason };

/**
 * Pure — sin I/O. Determinística dado (consultora, suscripcion, now).
 * Unit-testeable con fixtures hardcoded sin mockear DB.
 */
export function getBillingStatus(
  consultora: Pick<CurrentConsultora, 'plan' | 'trialHasta'>,
  suscripcion: SuscripcionRow | null,
  now: Date = new Date(),
): BillingStatus {
  if (env.BILLING_GATE_DISABLED === 'true') return { ok: true };

  if (suscripcion) {
    if (suscripcion.estado === 'expirada') {
      return { ok: false, reason: 'SUBSCRIPTION_EXPIRED' };
    }
    if (suscripcion.estado === 'cancelada') {
      // cancelar_en NULL = cancelada por MP por falta de pago (sin período de gracia
      // pendiente) -> churn, bloquea ya (T-124, cierra el leak). cancelar_en >= now() =
      // gracia viva (cancelación user-iniciada, activa hasta fin del período) -> ok.
      const cancelarEn = suscripcion.cancelar_en ? new Date(suscripcion.cancelar_en) : null;
      if (!cancelarEn || cancelarEn < now) {
        return { ok: false, reason: 'SUBSCRIPTION_CANCELLED' };
      }
    }
    return { ok: true };
  }

  if (consultora.plan === 'trial') {
    const trialHasta = consultora.trialHasta ? new Date(consultora.trialHasta) : null;
    if (!trialHasta || trialHasta < now) {
      return { ok: false, reason: 'TRIAL_EXPIRED' };
    }
  }
  return { ok: true };
}

/**
 * Helper para server actions: post-`getCurrentConsultora`, pre-INSERT.
 * Fetch de suscripción + cálculo. La consultora ya viene cargada del
 * `getCurrentConsultora` que las actions ya invocan.
 */
export async function requireBillingAccess(
  supabase: SupabaseClient<Database>,
  consultora: Pick<CurrentConsultora, 'plan' | 'trialHasta'>,
): Promise<BillingStatus> {
  const suscripcion = await getActiveSubscription(supabase);
  return getBillingStatus(consultora, suscripcion);
}
