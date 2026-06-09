import 'server-only';

import { createClient } from '@/shared/supabase/server';

import { AttentionQueue } from './AttentionQueue';
import { DashboardCounters } from './DashboardCounters';
import { DashboardSidebar } from './DashboardSidebar';
import { buildPulseLine } from './format';
import { getDashboardData } from './queries';

/**
 * T-131 · Subárbol de datos del dashboard. ÚNICO punto de `await` del tablero
 * (un solo `Promise.all` en `getDashboardData`) — vive detrás de un `<Suspense>`
 * en `DashboardView` para que el shell (saludo + accesos + FAB) streamee al
 * instante. Crea su propio client + `getUser()` defensivo, igual que el viejo
 * `ProximosVencimientosPanel`.
 */
export async function DashboardData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { metrics, attention, recentDrafts } = await getDashboardData(supabase);

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm" data-testid="dashboard-pulso">
        {buildPulseLine(metrics)}
      </p>

      <DashboardCounters metrics={metrics} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AttentionQueue items={attention} />
        </div>
        <DashboardSidebar recentDrafts={recentDrafts} />
      </div>
    </div>
  );
}
