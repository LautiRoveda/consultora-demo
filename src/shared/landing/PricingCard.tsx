import { CheckIcon } from 'lucide-react';
import Link from 'next/link';

import { TRIAL_DAYS } from '@/shared/lib/trial-days';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader } from '@/shared/ui/card';

/**
 * T-108 · Card de pricing reutilizable para landing + /precios.
 *
 * Variantes:
 *  - `full`: hero de /precios (texto descriptivo, CTA grande, énfasis precio).
 *  - `mini`: teaser de la landing (más compacto, mismo CTA, link "Ver precios").
 *
 * Server Component (todo es estático). Features default cubren el plan único
 * MVP — el caller puede override si quiere mostrar un subconjunto.
 */

export type PricingCardVariant = 'full' | 'mini';

interface PricingCardProps {
  variant?: PricingCardVariant;
  features?: readonly string[];
  ctaLabel?: string;
  ctaHref?: string;
}

const DEFAULT_FEATURES = [
  'Informes técnicos ilimitados con IA que cita la Res SRT',
  'EPP con planilla Res 299/11 firmada y entregada',
  'Calendario de vencimientos multi-canal (email + Telegram + push)',
  'Empleados y clientes ilimitados',
  'Audit log inmutable ISO 45001',
  'PDFs con tu logo y datos profesionales',
  'Soporte por WhatsApp con respuesta en horas',
] as const;

export function PricingCard({
  variant = 'full',
  features = DEFAULT_FEATURES,
  ctaLabel = `Empezar ${TRIAL_DAYS} días gratis`,
  ctaHref = '/signup',
}: PricingCardProps) {
  const isFull = variant === 'full';

  return (
    <Card
      className={
        isFull
          ? 'border-primary shadow-primary/10 relative mx-auto max-w-md border-2 shadow-lg'
          : 'border-primary/40 relative mx-auto max-w-sm border'
      }
    >
      <span className="bg-primary text-primary-foreground absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium">
        <span aria-hidden="true">{'⭐'}</span>
        Plan único
      </span>

      <CardHeader className="pt-6">
        <p className="text-muted-foreground text-sm font-medium">Plan Pro</p>
        <p className="mt-1">
          <span className={isFull ? 'text-5xl font-semibold' : 'text-3xl font-semibold'}>
            ARS 30.000
          </span>
          <span className="text-muted-foreground text-base font-normal"> / mes</span>
        </p>
        <p className="text-muted-foreground text-sm">
          Pagando anual: <span className="text-foreground font-medium">ARS 25.500/mes</span>{' '}
          <span className="text-severity-ok">(−15%)</span>
        </p>
        {isFull ? (
          <p className="text-muted-foreground mt-2 text-sm">
            Para higienista freelance individual con 1 a 10 clientes.
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm">
              <CheckIcon className="text-severity-ok mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <Button asChild className="w-full" size={isFull ? 'lg' : 'default'}>
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
        <p className="text-muted-foreground text-center text-xs">
          {TRIAL_DAYS} días sin tarjeta · Cancelás en 1 click
        </p>
      </CardContent>
    </Card>
  );
}
