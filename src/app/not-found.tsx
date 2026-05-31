import type { Metadata } from 'next';
import Link from 'next/link';

import { LandingFooter } from '@/shared/landing/LandingFooter';
import { LandingHeader } from '@/shared/landing/LandingHeader';
import { Button } from '@/shared/ui/button';

/**
 * T-108-FU1 · 404 custom para reemplazar el default de Next.js (pantalla
 * negra con "This page could not be found"). Reutiliza el LandingHeader +
 * LandingFooter para mantener el branding y el camino de vuelta al producto.
 */
export const metadata: Metadata = {
  title: 'Página no encontrada',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      <LandingHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-4 py-24 text-center sm:py-32">
          <p className="text-muted-foreground text-sm font-semibold uppercase tracking-wide">
            Error 404
          </p>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Esta página no existe (todavía).
          </h1>
          <p className="text-foreground/80 mx-auto mt-6 max-w-xl text-lg">
            Si llegaste acá desde un link, probablemente lo movimos o ya no está. Volvé al inicio o
            mirá los planes.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/">Volver al inicio</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/precios">Ver planes</Link>
            </Button>
          </div>
        </section>
      </main>
      <LandingFooter />
    </>
  );
}
