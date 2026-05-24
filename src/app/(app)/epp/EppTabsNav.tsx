'use client';

import { ClipboardCheck, ListChecks, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/shared/lib/utils';

/**
 * T-102-FU1 / T-106 · Tabs sub-nav del módulo EPP (Padrón / Entregas / Catálogo).
 *
 * Pattern copia estructural de `SettingsTabsNav` (T-035): `<Link>` plano +
 * clases manuales (no shadcn `Tabs`). El match acepta sub-rutas vía
 * `pathname.startsWith(t.href + '/')` — `/epp/entregas/nueva` y
 * `/epp/entregas/[id]` siguen resaltando "Entregas". Idem `/epp/catalogo/items`
 * resalta "Catálogo".
 *
 * T-106: Padrón primero (es la landing default del módulo — el redirect raíz
 * `/epp` apunta a `/epp/padron`). Catálogo queda al final porque es la vista
 * de menor frecuencia de uso post-setup inicial.
 */

const TABS = [
  { href: '/epp/padron', label: 'Padrón', icon: Users },
  { href: '/epp/entregas', label: 'Entregas', icon: ClipboardCheck },
  { href: '/epp/catalogo', label: 'Catálogo', icon: ListChecks },
] as const;

export function EppTabsNav() {
  const pathname = usePathname();

  return (
    <nav
      role="tablist"
      aria-label="Sección del módulo EPP"
      className="bg-muted/30 inline-flex items-center gap-1 rounded-md border p-1"
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
              'inline-flex items-center gap-1.5 rounded-sm px-3 py-1 text-sm font-medium transition-colors',
              active
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
            )}
            data-testid={`epp-tab-${t.href.split('/').pop()}`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
