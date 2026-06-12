import type { Metadata } from 'next';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import { DashboardView } from './DashboardView';

export const metadata: Metadata = {
  title: 'Dashboard · ConsultoraDemo',
  description: 'Panel principal de tu consultora.',
  robots: { index: false, follow: false },
};

interface DashboardPageProps {
  searchParams: Promise<{ reset?: string }>;
}

/**
 * Dashboard del shell autenticado (T-017 · rediseño operativo T-131).
 *
 * La validación de sesión + carga de consultora ocurre en `(app)/layout.tsx`,
 * que envuelve este page con el `<AppShell>`. Acá leemos el flag `?reset=ok`
 * (T-014, banner post password recovery) y el nombre de la consultora para el
 * saludo (lectura fast-path del claim JWT, T-016). Los datos pesados del tablero
 * los fetchea `DashboardData` detrás de un `<Suspense>` (streaming del shell).
 */
export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { reset } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const consultora = user ? await getCurrentConsultora(supabase, user.id) : null;

  return (
    <DashboardView
      showResetSuccess={reset === 'ok'}
      consultoraNombre={consultora?.name ?? null}
      showOnboarding={!!consultora && !consultora.onboardingCompletadoAt}
    />
  );
}
