/**
 * T-142 · Destinos válidos del paso 2 del wizard de onboarding. El paso 2 es un
 * fork de dos caminos (generar informe / registrar EPP); el wizard los usa como
 * hrefs de navegación.
 */
export const ONBOARDING_DESTINATIONS = ['/informes/nuevo', '/epp/entregas/nueva'] as const;

export type OnboardingDestination = (typeof ONBOARDING_DESTINATIONS)[number];
