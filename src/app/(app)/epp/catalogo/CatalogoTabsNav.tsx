'use client';

import { Briefcase, FolderTree, HardHat } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/shared/lib/utils';

const TABS = [
  { href: '/epp/catalogo/items', label: 'Items', icon: HardHat, key: 'items' },
  { href: '/epp/catalogo/categorias', label: 'Categorías', icon: FolderTree, key: 'categorias' },
  { href: '/epp/catalogo/puestos', label: 'Puestos', icon: Briefcase, key: 'puestos' },
] as const;

export function CatalogoTabsNav({ activeKey }: { activeKey: 'items' | 'categorias' | 'puestos' }) {
  const pathname = usePathname();

  return (
    <nav
      role="tablist"
      aria-label="Catálogo EPP"
      className="bg-muted/30 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-md border p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((t) => {
        const active =
          activeKey === t.key || pathname === t.href || pathname.startsWith(t.href + '/');
        return (
          <Link
            key={t.key}
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
            data-testid={`catalogo-tab-${t.key}`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
