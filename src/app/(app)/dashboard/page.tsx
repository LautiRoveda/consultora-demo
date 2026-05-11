import type { Metadata } from 'next';

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
 * Dashboard del shell autenticado (T-017).
 *
 * La validación de sesión + carga de consultora ocurre en `(app)/layout.tsx`,
 * que envuelve este page con el `<AppShell>`. Acá sólo leemos el flag
 * `?reset=ok` (T-014, banner post password recovery).
 */
export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { reset } = await searchParams;
  return <DashboardView showResetSuccess={reset === 'ok'} />;
}
