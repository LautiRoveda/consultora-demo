import { describe, expect, it } from 'vitest';

import { QUICK_LINKS } from '@/app/(app)/dashboard/quick-links';
import { NAV_ITEMS } from '@/shared/ui/app-shell/nav-items';

/**
 * Guard anti-drift (T-127 · Tanda 7).
 *
 * El dashboard ("Accesos rápidos", `QUICK_LINKS`) y el sidebar (`NAV_ITEMS`) son
 * dos listas mantenidas a mano por separado. Cuando se suma un módulo nuevo al
 * sidebar es fácil olvidarse de sumarlo al dashboard → el dashboard se queda
 * corto sin que nada lo detecte. Este test falla si esa cobertura se rompe.
 *
 * "Módulo de negocio" = item `live` de `NAV_ITEMS` excluyendo `/dashboard` (el
 * propio destino) y los `/settings/*` (configuración, no son accesos rápidos).
 */
const businessModules = NAV_ITEMS.filter(
  (item) =>
    item.status === 'live' && item.href !== '/dashboard' && !item.href.startsWith('/settings/'),
);

const quickLinkHrefs = new Set<string>(QUICK_LINKS.map((q) => q.href));
const navHrefs = new Set<string>(NAV_ITEMS.map((n) => n.href));

describe('dashboard · QUICK_LINKS cubre los módulos de negocio de NAV_ITEMS (T-127)', () => {
  it('cada módulo de negocio live tiene su acceso rápido en el dashboard', () => {
    const missing = businessModules.map((m) => m.href).filter((href) => !quickLinkHrefs.has(href));
    expect(missing).toEqual([]);
  });

  it('ningún acceso rápido apunta a un href inexistente en NAV_ITEMS', () => {
    const orphan = [...quickLinkHrefs].filter((href) => !navHrefs.has(href));
    expect(orphan).toEqual([]);
  });
});
