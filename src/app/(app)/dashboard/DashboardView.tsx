import { Suspense } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';

import { DashboardData } from './DashboardData';
import { DashboardFab } from './DashboardFab';
import { DashboardSkeleton } from './DashboardSkeleton';
import { QuickLinksRow } from './QuickLinksRow';

type DashboardViewProps = {
  showResetSuccess?: boolean;
  consultoraNombre?: string | null;
};

/**
 * T-131 · Tablero operativo (fase A). Responde "¿qué hago hoy?", no "¿a dónde voy?".
 *
 * Shell síncrono (saludo + accesos rápidos + FAB) que streamea al instante, con
 * el subárbol de datos (`DashboardData`: pulso + contadores + cola de atención +
 * columna derecha) detrás de un `<Suspense>`. El nombre de la consultora y el
 * menú de cuenta los muestra el `<AppShell>` aguas arriba.
 *
 *  - Banner post-recovery (T-014) — se mantiene.
 *  - Saludo + pulso operativo.
 *  - Banda de 4 contadores accionables + "Lo que necesita tu atención".
 *  - Accesos rápidos demotados a fila compacta (T-131; antes 9 cards).
 *
 * `pb-24 md:pb-8`: deja aire para que el FAB móvil no tape el final del contenido.
 */
export function DashboardView({ showResetSuccess, consultoraNombre }: DashboardViewProps) {
  return (
    <div className="space-y-8 pb-24 md:pb-8">
      {/* TEMP T-131 · overflow intencional para demo red→green del assert responsive
          (dashboard-responsive.spec). Se quita en el commit siguiente → CI E2E verde. */}
      <div aria-hidden="true" className="h-px min-w-[700px]" data-testid="t131-overflow-demo" />
      {showResetSuccess ? (
        <Alert>
          <AlertTitle>Contraseña actualizada</AlertTitle>
          <AlertDescription>Tu nueva contraseña ya está activa.</AlertDescription>
        </Alert>
      ) : null}

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">
          Buen día{consultoraNombre ? `, ${consultoraNombre}` : ''}
        </h1>
      </header>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardData />
      </Suspense>

      <QuickLinksRow />

      <DashboardFab />
    </div>
  );
}
