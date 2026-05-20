'use client';

import { Info, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/shared/lib/utils';

interface Props {
  clienteId: string;
}

/**
 * T-055 · Tabs del detail view del cliente (Detalle / Empleados).
 *
 * Mismo patrón que `SettingsTabsNav` (T-035) + `CalendarTabsNav` (T-030):
 * `<Link>` plano sin shadcn `Tabs`. Cada tab navega a otra ruta.
 *
 * Active matching: `pathname === t.href` EXACT (no `startsWith`). Razón:
 * `/clientes/[id]/empleados`.startsWith(`/clientes/[id]/`) === true, lo cual
 * haría matchear el tab Detalle cuando estás en Empleados. Los 2 paths son
 * disjoint, exact es lo correcto. Como side-effect, en `/clientes/[id]/editar`
 * NO se highlightea ningún tab (el page de editar tampoco renderiza estos
 * tabs por decisión arquitectural T-055).
 */
export function ClienteTabsNav({ clienteId }: Props) {
  const pathname = usePathname();

  const tabs = [
    { href: `/clientes/${clienteId}`, label: 'Detalle', icon: Info, testId: 'cliente-tab-detalle' },
    {
      href: `/clientes/${clienteId}/empleados`,
      label: 'Empleados',
      icon: UserCheck,
      testId: 'cliente-tab-empleados',
    },
  ] as const;

  return (
    <nav
      role="tablist"
      aria-label="Sección del cliente"
      className="bg-muted/30 inline-flex items-center gap-1 rounded-md border p-1"
    >
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm px-3 py-1 text-sm font-medium transition-colors',
              active
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
            )}
            data-testid={t.testId}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
