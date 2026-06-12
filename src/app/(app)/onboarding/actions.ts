'use server';

import type { OnboardingDestination } from './schema';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import { completeOnboardingSchema } from './schema';

/**
 * T-142 · Marca `consultoras.onboarding_completado_at = NOW()` y devuelve la
 * destination para que el cliente haga el redirect.
 *
 * UPDATE con el client autenticado (NO service-role): el owner ya tiene UPDATE
 * sobre su propia consultora vía la policy `consultoras_update_own_owner`
 * (WITH CHECK `is_owner_of_consultora`). El gate explícito `role !== 'owner'` es
 * defensa en profundidad + permite devolver UNAUTHORIZED con mensaje. Patrón
 * `updateAutoCreateEventToggleAction` (settings/consultora/actions.ts).
 *
 * `ALREADY_DONE` es idempotente, no es un error real: el wizard ya desaparece
 * del dashboard cuando la columna está seteada, pero una doble llamada en vuelo
 * no debe romper.
 */
export type CompleteOnboardingResult =
  | { ok: true; redirectTo: OnboardingDestination }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'UNAUTHORIZED' | 'ALREADY_DONE' | 'INTERNAL_ERROR';
      message: string;
    };

export async function completeOnboardingAction(input: unknown): Promise<CompleteOnboardingResult> {
  const parsed = completeOnboardingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Destino inválido.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED', message: 'Iniciá sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora || consultora.role !== 'owner') {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'Solo el owner puede completar el onboarding.',
    };
  }

  if (consultora.onboardingCompletadoAt !== null) {
    return { ok: false, code: 'ALREADY_DONE', message: 'El onboarding ya fue completado.' };
  }

  const { data: updated, error } = await supabase
    .from('consultoras')
    .update({ onboarding_completado_at: new Date().toISOString() })
    .eq('id', consultora.id)
    .select('id');

  if (error || !updated || updated.length === 0) {
    logger.error(
      { err: error, consultoraId: consultora.id, userId: user.id },
      'completeOnboardingAction: update fallo',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'No se pudo completar el onboarding.' };
  }

  return { ok: true, redirectTo: parsed.data.destination };
}
