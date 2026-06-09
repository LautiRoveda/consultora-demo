import { Plus } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/shared/lib/utils';
import { buttonVariants } from '@/shared/ui/button';

/**
 * T-131 · Acción primaria fija (FAB) en móvil: "Nuevo informe".
 *
 * Solo móvil (`md:hidden`) — en desktop la CTA primaria vive en la columna
 * derecha. `<Link>` plano (sin JS de cliente). `env(safe-area-inset-bottom)`
 * para librar el home indicator de iOS.
 */
export function DashboardFab() {
  return (
    <Link
      href="/informes/nuevo"
      data-testid="dashboard-fab"
      className={cn(
        buttonVariants({ size: 'lg' }),
        'fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 shadow-lg md:hidden',
      )}
    >
      <Plus className="h-5 w-5" aria-hidden="true" />
      Nuevo informe
    </Link>
  );
}
