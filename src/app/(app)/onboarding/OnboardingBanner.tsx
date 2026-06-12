import { createClient } from '@/shared/supabase/server';

import { countClientesActivos } from '../clientes/queries';
import { OnboardingWizard } from './OnboardingWizard';

/**
 * T-142 · Server component que resuelve el estado del paso 1 (¿hay clientes?) y
 * renderiza el wizard. Vive aparte de `DashboardData` para que el banner pueda
 * streamear sin esperar el `Promise.all` pesado del tablero. El conteo filtra
 * por RLS vía el claim del JWT, así que no necesita `consultoraId` explícito.
 */
export async function OnboardingBanner() {
  const supabase = await createClient();
  const count = await countClientesActivos(supabase);
  return <OnboardingWizard hasCliente={count > 0} />;
}
