import Link from 'next/link';

import { cn } from '@/shared/lib/utils';

type TabKey = 'agentes' | 'exposicion';

const TABS: ReadonlyArray<{ key: TabKey; href: string; label: string }> = [
  { key: 'agentes', href: '/rar/agentes', label: 'Agentes' },
  { key: 'exposicion', href: '/rar/exposicion', label: 'Exposición' },
];

export function RarTabsNav({ activeKey }: { activeKey: TabKey }) {
  return (
    <nav className="flex gap-1 border-b">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            tab.key === activeKey
              ? 'border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground border-transparent',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
