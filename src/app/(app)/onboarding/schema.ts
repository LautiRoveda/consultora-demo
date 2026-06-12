import { z } from 'zod';

/**
 * T-142 · Destinos válidos del wizard de onboarding. El paso 2 del wizard es un
 * fork de dos caminos; el usuario elige uno y lo mandamos ahí tras marcar el
 * onboarding como completo.
 */
export const ONBOARDING_DESTINATIONS = ['/informes/nuevo', '/epp/entregas/nueva'] as const;

export type OnboardingDestination = (typeof ONBOARDING_DESTINATIONS)[number];

export const completeOnboardingSchema = z.object({
  destination: z.enum(ONBOARDING_DESTINATIONS, { message: 'Destino inválido.' }),
});
