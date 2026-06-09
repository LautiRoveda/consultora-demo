import type { LucideIcon } from 'lucide-react';
import type { DashboardMetrics } from './queries';
import { AlertTriangle, Bell, FileText, ListChecks } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/shared/lib/utils';

/**
 * T-131 · Banda de 4 contadores accionables, clickeables a su lista.
 *
 * Cada contador = acción requerida (no total histórico). Clickeable a la lista
 * existente (fase A; filtros por query param → FU). Semáforo con texto, no solo
 * color: el número + el label ya comunican la urgencia (el rojo es refuerzo).
 */

type CounterDef = {
  testId: string;
  label: string;
  value: number;
  href: string;
  icon: LucideIcon;
  /** Resalta en rojo cuando hay acción requerida. */
  danger: boolean;
};

export function DashboardCounters({ metrics }: { metrics: DashboardMetrics }) {
  const counters: CounterDef[] = [
    {
      testId: 'counter-vencen-semana',
      label: 'Vencen esta semana',
      value: metrics.vencenSemana,
      href: '/calendario/agenda',
      icon: Bell,
      danger: metrics.vencenSemana > 0,
    },
    {
      testId: 'counter-vencidos',
      label: 'Vencidos',
      value: metrics.vencidos,
      href: '/calendario/agenda',
      icon: AlertTriangle,
      danger: metrics.vencidos > 0,
    },
    {
      testId: 'counter-borradores',
      label: 'Informes en borrador',
      value: metrics.borradores,
      href: '/informes',
      icon: FileText,
      danger: false,
    },
    {
      testId: 'counter-capas',
      label: 'Acciones abiertas',
      value: metrics.accionesAbiertas,
      href: '/checklists/ejecuciones',
      icon: ListChecks,
      danger: false,
    },
  ];

  return (
    <section aria-labelledby="dashboard-counters-heading" data-testid="dashboard-counters">
      <h2 id="dashboard-counters-heading" className="sr-only">
        Resumen accionable
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counters.map((c) => {
          const Icon = c.icon;
          const active = c.danger && c.value > 0;
          return (
            <Link
              key={c.testId}
              href={c.href}
              data-testid={c.testId}
              data-count={c.value}
              className={cn(
                'group flex items-start gap-3 rounded-lg border p-3 outline-none transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                active
                  ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
                  : 'bg-card hover:bg-accent/40',
              )}
            >
              <span
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-md p-1.5',
                  active ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    'block text-2xl font-bold leading-tight',
                    active && 'text-destructive',
                  )}
                >
                  {c.value}
                </span>
                <span className="text-foreground block text-xs font-medium leading-tight">
                  {c.label}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
