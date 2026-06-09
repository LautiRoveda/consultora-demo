import { Skeleton } from '@/shared/ui/skeleton';

/**
 * T-131 · Fallback del `<Suspense>` que envuelve `DashboardData`. Espeja la
 * estructura (pulso + banda de 4 contadores + cola/columna) para que el shell
 * streamee sin layout shift.
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" data-testid="dashboard-skeleton" aria-hidden="true">
      <Skeleton className="h-4 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
