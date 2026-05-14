'use client';

import type { CurrentConsultora } from '@/shared/auth/types';
import { Menu } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Separator } from '@/shared/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/shared/ui/sheet';
import { TooltipProvider } from '@/shared/ui/tooltip';

import { AppSidebarNav } from './AppSidebarNav';
import { AppUserMenu } from './AppUserMenu';

type AppShellUser = {
  id: string;
  email: string;
};

type AppSidebarProps = {
  user: AppShellUser;
  consultora: CurrentConsultora;
  /** T-024-FU0.5: signed URL del logo (TTL 1h). Null → fallback al placeholder "CD". */
  logoSignedUrl: string | null;
};

/**
 * Sidebar del shell autenticado. Una sola implementación, dos disposiciones:
 *   - Desktop (md+): `<aside>` fija a la izquierda (w-64).
 *   - Mobile (<md): `<header>` con hamburger que abre un Sheet lateral.
 *
 * Ambas comparten `<SidebarContents>` para evitar drift entre layouts.
 * El `TooltipProvider` envuelve todo porque los nav items "soon" usan
 * Tooltip — viven en el árbol cliente, así que el provider va acá.
 */
export function AppSidebar({ user, consultora, logoSignedUrl }: AppSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <TooltipProvider>
      <aside
        aria-label="Barra lateral"
        className="bg-card text-card-foreground fixed inset-y-0 left-0 z-30 hidden w-64 border-r md:flex md:flex-col"
      >
        <SidebarContents user={user} consultora={consultora} logoSignedUrl={logoSignedUrl} />
      </aside>

      <header className="bg-background sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-4 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Abrir menú">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Menú principal</SheetTitle>
            <SheetDescription className="sr-only">
              Navegación de la consultora y opciones de cuenta.
            </SheetDescription>
            <SidebarContents
              user={user}
              consultora={consultora}
              logoSignedUrl={logoSignedUrl}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <span className="truncate text-sm font-semibold">{consultora.name}</span>
      </header>
    </TooltipProvider>
  );
}

function SidebarContents({
  user,
  consultora,
  logoSignedUrl,
  onNavigate,
}: {
  user: AppShellUser;
  consultora: CurrentConsultora;
  logoSignedUrl: string | null;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConsultoraHeader consultora={consultora} logoSignedUrl={logoSignedUrl} />
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AppSidebarNav onNavigate={onNavigate} />
      </div>
      <Separator />
      <div className="p-2">
        <AppUserMenu email={user.email} />
      </div>
    </div>
  );
}

function ConsultoraHeader({
  consultora,
  logoSignedUrl,
}: {
  consultora: CurrentConsultora;
  logoSignedUrl: string | null;
}) {
  const isTrial = consultora.planTier === 'trial';

  return (
    <div className="flex items-center gap-3 px-4 py-4">
      {logoSignedUrl ? (
        // T-024-FU0.5: refuerzo de ownership UX. Si la consultora subio logo,
        // lo mostramos en lugar del placeholder "CD". next/image requeriria
        // configurar remotePatterns para *.supabase.co; <img> con unoptimized
        // es mas simple y la signed URL ya tiene TTL 1h del server.
        // eslint-disable-next-line @next/next/no-img-element -- Signed URL externa con TTL; usar <img> directo para evitar remotePatterns config.
        <img
          src={logoSignedUrl}
          alt={`Logo de ${consultora.name}`}
          className="bg-muted size-9 shrink-0 rounded-md object-contain"
        />
      ) : (
        <div
          className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold"
          aria-hidden="true"
        >
          CD
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{consultora.name}</p>
        <p className="text-muted-foreground truncate text-xs">@{consultora.slug}</p>
      </div>
      {isTrial ? (
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}
        >
          Trial
        </span>
      ) : null}
    </div>
  );
}
