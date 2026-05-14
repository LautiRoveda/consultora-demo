import type { ReactNode } from 'react';

/**
 * T-024 · Layout de Settings. Por ahora solo una seccion (Consultora);
 * placeholder para futuras tabs (Perfil, Billing, etc).
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
          Gestioná los datos y el branding de tu consultora.
        </p>
      </div>
      {children}
    </div>
  );
}
