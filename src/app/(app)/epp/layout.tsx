import type { ReactNode } from 'react';

import { EppTabsNav } from './EppTabsNav';

/**
 * T-102-FU1 · Layout del módulo EPP con header + sub-nav (Catálogo / Entregas).
 *
 * Pattern copia estructural de `(app)/settings/layout.tsx`. Wrappea TODAS las
 * pages `/epp/*` (incluyendo `/epp/catalogo/items` y `/epp/entregas/[id]`).
 * `/epp/page.tsx` mantiene su redirect a `/epp/catalogo` — el layout no afecta
 * porque el redirect resuelve antes de renderear children.
 *
 * No requiere auth gate adicional — `(app)/layout.tsx` ya valida sesión.
 */
export default function EppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">
          Módulo EPP
        </h1>
        <p className="text-muted-foreground text-sm">
          Gestioná tu catálogo de items y las entregas con firma Res SRT 299/11.
        </p>
      </div>
      <EppTabsNav />
      {children}
    </div>
  );
}
