'use client';

import type { NavItem } from './nav-items';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/shared/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';

import { NAV_ITEMS } from './nav-items';

type AppSidebarNavProps = {
  /** Callback invocado tras click en un item activo (cierra el Sheet mobile). */
  onNavigate?: () => void;
};

export function AppSidebarNav({ onNavigate }: AppSidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegación principal" className="flex-1 px-3 py-2">
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            {item.status === 'live' ? (
              <LiveItem item={item} pathname={pathname} onNavigate={onNavigate} />
            ) : (
              <SoonItem item={item} />
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function LiveItem({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}

function SoonItem({ item }: { item: NavItem }) {
  const Icon = item.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
            'text-muted-foreground/60 cursor-not-allowed',
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">{item.label}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Pronto
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        Próximamente{item.ticket ? ` (${item.ticket})` : ''}
      </TooltipContent>
    </Tooltip>
  );
}
