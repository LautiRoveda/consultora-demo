'use client';

import { Calendar, List } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/shared/lib/utils';

/**
 * T-030 · Tabs de navegacion del modulo Calendario (Mensual / Agenda).
 *
 * Las "tabs" son `<Link>` plano + clases manuales (no shadcn `Tabs`). Razon:
 * cada tab navega a otra ruta (`/calendario` vs `/calendario/agenda`), no
 * cambia state local. Reusar `Tabs` shadcn requeriria `value` derivado de
 * pathname + custom triggers como links — termina mas codigo.
 *
 * Vive separado del layout server para tener el `usePathname()` boundary
 * limpio sin contaminar el server layout con `'use client'`.
 */
const TABS = [
  { href: '/calendario', label: 'Mensual', icon: Calendar },
  { href: '/calendario/agenda', label: 'Agenda', icon: List },
] as const;

export function CalendarTabsNav() {
  const pathname = usePathname();

  return (
    <nav
      role="tablist"
      aria-label="Vista del calendario"
      className="bg-muted/30 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-md border p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors',
              active
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
            )}
            data-testid={`tab-${t.href === '/calendario' ? 'mensual' : 'agenda'}`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
