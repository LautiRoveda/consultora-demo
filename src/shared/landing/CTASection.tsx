import { MessageCircleIcon } from 'lucide-react';
import Link from 'next/link';

import { TRIAL_DAYS } from '@/shared/lib/trial-days';
import { Button } from '@/shared/ui/button';

import { WHATSAPP_LINK_HREF } from './whatsapp';

/**
 * T-108 · Sección CTA anti-objection reutilizable.
 *
 * Server Component. Usado al final de las 3 páginas (/, /precios, /features).
 * Defaults: heading + sub orientados al cierre por fricción cero (trial sin
 * tarjeta, cancelable, soporte humano por WhatsApp). El caller puede override
 * cualquier prop para variar el énfasis sin duplicar markup.
 */

interface CTASectionProps {
  heading?: string;
  subheading?: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  showWhatsApp?: boolean;
}

export function CTASection({
  heading = `Probalo ${TRIAL_DAYS} días sin tarjeta`,
  subheading = `Si en ${TRIAL_DAYS} días no te ahorrás varias horas de trabajo, no pagás nada. Simple.`,
  primaryLabel = 'Crear cuenta gratis',
  primaryHref = '/signup',
  secondaryLabel = 'Hablar por WhatsApp',
  showWhatsApp = true,
}: CTASectionProps) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:py-20">
      <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{heading}</h2>
      <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-base sm:text-lg">
        {subheading}
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button asChild size="lg" className="shadow-md transition-shadow hover:shadow-lg">
          <Link href={primaryHref}>{primaryLabel}</Link>
        </Button>
        {showWhatsApp ? (
          <Button asChild size="lg" variant="outline" className="gap-2">
            <a href={WHATSAPP_LINK_HREF} target="_blank" rel="noopener noreferrer">
              <MessageCircleIcon className="size-4" aria-hidden="true" />
              {secondaryLabel}
            </a>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
