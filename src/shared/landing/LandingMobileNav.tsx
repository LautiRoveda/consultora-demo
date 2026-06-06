'use client';

import { Menu, MessageCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/shared/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/shared/ui/sheet';

import { WHATSAPP_LINK_HREF } from './whatsapp';

/**
 * T-127 · Hamburguesa de la landing para <md.
 *
 * Los links Features/Precios/WhatsApp del header se ocultan en mobile
 * (hidden md:inline-flex); sin esto quedaban inalcanzables. Este Sheet los
 * expone. "Iniciar sesión" NO va acá: sigue inline siempre como CTA.
 *
 * Client Component aislado para no convertir LandingHeader (Server Component
 * compartido) en cliente. Patrón calcado de AppSidebar: trigger + Sheet +
 * cerrar al navegar (importa para WhatsApp, que abre en otra pestaña y no
 * desmonta la landing).
 */
export function LandingMobileNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menú">
          <Menu />
        </Button>
      </SheetTrigger>
      {/* SheetContent no trae padding y el botón cerrar es absolute top-4 right-4;
          mt-8 despeja ese botón y px-2 da el margen horizontal. */}
      <SheetContent side="right" className="w-64">
        <SheetTitle className="sr-only">Menú</SheetTitle>
        <SheetDescription className="sr-only">Navegación de la landing.</SheetDescription>
        <nav className="mt-8 flex flex-col gap-1 px-2" aria-label="Navegación móvil">
          <Button asChild variant="ghost" className="justify-start">
            <Link href="/features" onClick={close}>
              Features
            </Link>
          </Button>
          <Button asChild variant="ghost" className="justify-start">
            <Link href="/precios" onClick={close}>
              Precios
            </Link>
          </Button>
          <Button asChild variant="ghost" className="justify-start gap-1.5">
            <Link
              href={WHATSAPP_LINK_HREF}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
            >
              <MessageCircleIcon className="size-4" aria-hidden="true" />
              WhatsApp
            </Link>
          </Button>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
