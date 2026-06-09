'use client';

import { Bell, Building2, CreditCard } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/shared/lib/utils';

/**
 * T-035 · Tabs de navegacion de Settings (Consultora / Notificaciones).
 *
 * Mismo patron que `CalendarTabsNav` (T-030): `<Link>` plano + clases manuales
 * (no shadcn `Tabs`). Cada tab navega a otra ruta; reusar shadcn Tabs requeriria
 * `value` derivado del pathname + custom triggers como links → mas codigo.
 *
 * El match acepta sub-rutas (`pathname.startsWith(t.href + '/')`) para que en
 * el futuro `/settings/consultora/branding` siga resaltando "Consultora".
 */

const TABS = [
  { href: '/settings/consultora', label: 'Consultora', icon: Building2 },
  { href: '/settings/notificaciones', label: 'Notificaciones', icon: Bell },
  { href: '/settings/billing', label: 'Facturación', icon: CreditCard },
] as const;

export function SettingsTabsNav() {
  const pathname = usePathname();

  return (
    <nav
      role="tablist"
      aria-label="Seccion de configuracion"
      className="bg-muted/30 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-md border p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/');
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
            data-testid={`settings-tab-${t.href.split('/').pop()}`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
