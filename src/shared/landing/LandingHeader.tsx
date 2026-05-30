import { MessageCircleIcon } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';

import { WHATSAPP_LINK_HREF } from './whatsapp';

/**
 * T-108 · Header sticky compartido entre /, /precios y /features.
 *
 * Server Component. Reutilizado por las 3 páginas de la landing para evitar
 * duplicación + drift. Si cambia el nav, cambia en un solo lugar.
 *
 * Skip-link a `#main-content` se sigue declarando en cada page (no acá) para
 * que el target del skip sea el `<main>` específico de la página.
 */
export function LandingHeader() {
  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span
            className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md text-sm font-bold"
            aria-hidden="true"
          >
            CD
          </span>
          <span className="text-sm font-semibold">ConsultoraDemo</span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Navegación principal">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/features">Features</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/precios">Precios</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="text-foreground/80 hidden gap-1.5 md:inline-flex"
          >
            <Link href={WHATSAPP_LINK_HREF} target="_blank" rel="noopener noreferrer">
              <MessageCircleIcon className="size-4" aria-hidden="true" />
              WhatsApp
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Iniciar sesión</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
