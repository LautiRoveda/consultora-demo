import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import { DashboardEmpty } from './DashboardEmpty';
import { DashboardView } from './DashboardView';

export const metadata: Metadata = {
  title: 'Dashboard · ConsultoraDemo',
  description: 'Panel principal de tu consultora.',
  robots: { index: false, follow: false },
};

/**
 * Dashboard stub (T-013).
 *
 * Server Component protegido: getUser() valida sesión, sin user → redirect a
 * /login. Con user → leemos consultora_members + JOIN consultoras (vía RLS
 * policies `consultora_members_select_self` de T-011 + `consultoras_select_own_member`
 * de T-013, defensivas pre-T-016).
 *
 * T-017 va a reemplazar esto con el dashboard productivo + layout group
 * `(app)` con auth check centralizado.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: membership, error } = await supabase
    .from('consultora_members')
    .select('role, consultoras(id, slug, name, plan_tier, trial_ends_at)')
    .eq('user_id', user.id)
    .single();

  if (error || !membership?.consultoras) {
    // Edge case post-T-012 (signup atómico): no debería pasar.
    logger.error(
      { error, userId: user.id, hasMembership: !!membership },
      'dashboard: no se pudo leer la consultora del user',
    );
    return <DashboardEmpty email={user.email ?? '(sin email)'} />;
  }

  return (
    <DashboardView
      email={user.email ?? '(sin email)'}
      role={membership.role}
      consultora={membership.consultoras}
    />
  );
}
