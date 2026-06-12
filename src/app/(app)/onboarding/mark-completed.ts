import 'server-only';

import { logger } from '@/shared/observability/logger';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-142 · FU1 · Marca `consultoras.onboarding_completado_at` la PRIMERA vez que el
 * tenant hace una acción real (crear informe / registrar entrega EPP). Reemplaza el
 * marcado por-click del wizard.
 *
 * - Idempotente: `WHERE onboarding_completado_at IS NULL` (`.is(..., null)`) → nunca
 *   pisa un timestamp existente.
 * - Best-effort: cualquier error se loguea con `logger.warn` y se traga. NUNCA rompe la
 *   creación del informe/entrega ni cambia su return (retorna void, no throwea).
 * - Service-role: el actor que crea el informe/entrega puede no ser owner, y la policy
 *   `consultoras_update_own_owner` es owner-only → con client autenticado un member no
 *   marcaría nada (RLS silenciosa). El UPDATE es acotado (un id + IS NULL) y seguro.
 */
export async function markOnboardingCompletedIfPending(consultoraId: string): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const { error } = await admin
      .from('consultoras')
      .update({ onboarding_completado_at: new Date().toISOString() })
      .eq('id', consultoraId)
      .is('onboarding_completado_at', null);
    if (error) {
      logger.warn(
        { err: error, consultoraId },
        'markOnboardingCompletedIfPending: update fallo (best-effort, ignorado)',
      );
    }
  } catch (err) {
    logger.warn(
      { err, consultoraId },
      'markOnboardingCompletedIfPending: excepción inesperada (best-effort, ignorada)',
    );
  }
}
