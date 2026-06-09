import Link from 'next/link';

import { QUICK_LINKS } from './quick-links';

/**
 * T-131 · Accesos rápidos en fila compacta (antes eran 9 cards grandes).
 *
 * Mapea TODOS los `QUICK_LINKS` — el guard `dashboard-quick-links-coverage.test.ts`
 * exige que cada módulo de negocio `live` siga teniendo su acceso. La densidad baja
 * de 9 cards a pills para que el foco del home sea lo accionable, no la navegación.
 */
export function QuickLinksRow() {
  return (
    <section aria-labelledby="accesos-rapidos-heading" className="space-y-3">
      <h2
        id="accesos-rapidos-heading"
        className="text-muted-foreground text-xs font-semibold uppercase tracking-wide"
      >
        Accesos rápidos
      </h2>
      <ul className="flex flex-wrap gap-2">
        {QUICK_LINKS.map(({ href, icon: Icon, title }) => (
          <li key={href}>
            <Link
              href={href}
              className="bg-card hover:bg-accent/50 focus-visible:ring-ring inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              <Icon className="text-muted-foreground h-4 w-4" aria-hidden="true" />
              {title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
