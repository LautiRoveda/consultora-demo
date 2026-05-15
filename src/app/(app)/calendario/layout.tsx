import 'server-only';

import type { ReactNode } from 'react';

import { CalendarTabsNav } from './CalendarTabsNav';

/**
 * T-030 · Layout compartido del modulo Calendario.
 *
 * Server component. El layout `(app)` aguas arriba ya valida sesion +
 * consultora — aca solo armamos el chrome compartido entre la vista mensual
 * (`/calendario`) y la vista agenda (`/calendario/agenda`):
 *  - header con titulo + descripcion,
 *  - tabs de navegacion entre vistas.
 *
 * El CTA "Nuevo vencimiento" NO vive aca: dispara abrir-drawer-en-modo-create
 * que es state interno del client component de cada vista. Cada vista renderiza
 * su propio CTA al lado de los filtros.
 */
export default function CalendarioLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Calendario</h1>
        <p className="text-muted-foreground text-sm">
          Gestioná vencimientos de protocolos, EPP, calibraciones y capacitaciones.
        </p>
      </header>
      <CalendarTabsNav />
      {children}
    </div>
  );
}
