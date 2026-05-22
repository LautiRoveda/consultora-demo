import 'server-only';

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { getActiveSubscription } from '@/app/(app)/settings/billing/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { getBillingStatus } from '@/shared/billing/access';
import { logger } from '@/shared/observability/logger';
import { createSignedLogoUrl } from '@/shared/storage/logo';
import { SIGNED_URL_TTL_UI_SEC } from '@/shared/storage/types';
import { createClient } from '@/shared/supabase/server';
import { AppShell } from '@/shared/ui/app-shell/AppShell';

/**
 * Layout server-protected del route group `(app)` (T-017).
 *
 * Defensa de auth única para todas las páginas autenticadas: valida sesión y
 * carga consultora. Las páginas hijas (dashboard, futuros T-019+) sólo
 * declaran su contenido — heredan shell + auth check sin código duplicado.
 *
 * Edge cases:
 *   - sin sesión → `/login`.
 *   - sesión válida pero sin consultora asociada → `/login?error=no_consultora`
 *     y log a Sentry. Post-T-012 (signup atómico) no debería pasar; si pasa,
 *     es un bug de datos. `LoginForm` muestra el Alert acorde.
 *
 * El middleware (`src/proxy.ts`) refresca cookies pero no fuerza auth — esto
 * es la fuente única de verdad de la protección server-side.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const consultora = await getCurrentConsultora(supabase, user.id);

  if (!consultora) {
    logger.error(
      { userId: user.id },
      'app_layout: user autenticado sin consultora — redirect a /login',
    );
    redirect('/login?error=no_consultora');
  }

  // T-024-FU0.5: si la consultora tiene logo, pre-generamos signed URL TTL 1h
  // para mostrarlo en el sidebar (mismo patron que /settings/consultora y
  // /informes/[id]). Sin logo → null y el sidebar cae al placeholder "CD".
  let logoSignedUrl: string | null = null;
  if (consultora.logoStoragePath) {
    const { signedUrl } = await createSignedLogoUrl(
      supabase,
      consultora.logoStoragePath,
      SIGNED_URL_TTL_UI_SEC,
    );
    logoSignedUrl = signedUrl;
  }

  // T-073 · Cálculo del trial gate. Fetch de suscripción (RLS scope) + cálculo
  // puro. Si gated, el `<BillingGateBanner>` renderea sticky al top.
  const suscripcion = await getActiveSubscription(supabase);
  const billingStatus = getBillingStatus(consultora, suscripcion);

  return (
    <AppShell
      user={{ id: user.id, email: user.email ?? '' }}
      consultora={consultora}
      logoSignedUrl={logoSignedUrl}
      billingStatus={billingStatus}
    >
      {children}
    </AppShell>
  );
}
