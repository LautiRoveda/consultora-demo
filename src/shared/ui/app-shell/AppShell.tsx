import type { CurrentConsultora } from '@/shared/auth/types';
import type { ReactNode } from 'react';

import { AppSidebar } from './AppSidebar';

type AppShellProps = {
  user: { id: string; email: string };
  consultora: CurrentConsultora;
  children: ReactNode;
};

/**
 * Wrapper top-level del shell autenticado. Server component — sólo arma la
 * estructura y delega la interactividad al `<AppSidebar>` cliente.
 *
 * Layout:
 *   - Desktop (md+): sidebar fija a la izquierda 16rem (w-64), main a la
 *     derecha con padding-left equivalente.
 *   - Mobile (<md): sidebar oculta, header sticky con hamburger encima del
 *     main. El `pl-0` en mobile cubre el reset implícito.
 */
export function AppShell({ user, consultora, children }: AppShellProps) {
  return (
    <div className="bg-background min-h-svh">
      <AppSidebar user={user} consultora={consultora} />
      <div className="md:pl-64">
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
