import type { ReactNode } from 'react';

import { SettingsTabsNav } from './SettingsTabsNav';

/**
 * T-024 · Layout de Settings.
 * T-035 · Suma sub-tabs `[Consultora] [Notificaciones]` debajo del header.
 *
 * No requiere auth/gate adicional — el layout `(app)/layout.tsx` ya valida
 * sesion + consultora. Las paginas hijas hacen sus propios checks por feature
 * (ej. logo upload es owner-only en el server action / route handler).
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground text-sm">
          Gestioná los datos de tu consultora y tus preferencias de notificación.
        </p>
      </div>
      <SettingsTabsNav />
      {children}
    </div>
  );
}
