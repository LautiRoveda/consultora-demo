import type { ReactNode } from 'react';

import { EppTabsNav } from './EppTabsNav';

/**
 * T-102-FU1 / T-106 · Layout del módulo EPP con header + sub-nav (Padrón /
 * Entregas / Catálogo).
 *
 * Pattern copia estructural de `(app)/settings/layout.tsx`. Wrappea TODAS las
 * pages `/epp/*` (incluyendo `/epp/catalogo/items`, `/epp/entregas/[id]` y
 * `/epp/padron`). `/epp/page.tsx` redirige a `/epp/padron` — el layout no
 * afecta porque el redirect resuelve antes de renderear children.
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
          Padrón empleados, catálogo de items y entregas firmadas (Res SRT 299/11).
        </p>
      </div>
      <EppTabsNav />
      {children}
    </div>
  );
}
