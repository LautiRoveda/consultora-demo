import 'server-only';

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
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

  return (
    <AppShell user={{ id: user.id, email: user.email ?? '' }} consultora={consultora}>
      {children}
    </AppShell>
  );
}
