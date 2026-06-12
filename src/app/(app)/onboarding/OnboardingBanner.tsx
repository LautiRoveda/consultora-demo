import { cookies } from 'next/headers';

import { createClient } from '@/shared/supabase/server';

import { countClientesActivos } from '../clientes/queries';
import { OnboardingWizard } from './OnboardingWizard';

/**
 * T-142 · Server component que resuelve el estado del paso 1 (¿hay clientes?) y
 * renderiza el wizard. Vive aparte de `DashboardData` para que el banner pueda
 * streamear sin esperar el `Promise.all` pesado del tablero. El conteo filtra
 * por RLS vía el claim del JWT, así que no necesita `consultoraId` explícito.
 *
 * T-142 · FU2 · Lee la cookie `onboarding_collapsed` y la pasa como
 * `defaultCollapsed` para que el wizard SSR-rendee ya colapsado/expandido sin
 * parpadeo en cada carga.
 */
export async function OnboardingBanner() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const count = await countClientesActivos(supabase);
  const defaultCollapsed = cookieStore.get('onboarding_collapsed')?.value === '1';
  return <OnboardingWizard hasCliente={count > 0} defaultCollapsed={defaultCollapsed} />;
}
