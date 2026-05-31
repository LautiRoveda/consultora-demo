import { CheckIcon } from 'lucide-react';
import Link from 'next/link';

import { formatARS, formatARSMonthly } from '@/shared/lib/format-ars';
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
 *
 * T-108 CP2: `priceCentavos` consume `formatARSMonthly` / `formatARS` para
 * mantener el display sincronizado con `env.ARS_PRICE_MONTHLY` cuando el
 * caller server-side lo pasa. Default `DEFAULT_PRICE_CENTAVOS = 3_000_000`
 * (ARS 30.000/mes) para que la card siga renderizando OK en client/test/
 * styleguide sin tener acceso al env. El precio anual se computa como
 * `monthly * ANNUAL_DISCOUNT_RATIO` (15% off — decisión comercial ADR-0014).
 */

export type PricingCardVariant = 'full' | 'mini';

interface PricingCardProps {
  variant?: PricingCardVariant;
  /** Precio mensual en centavos ARS. Default 3.000.000 = ARS 30.000/mes. */
  priceCentavos?: number;
  features?: readonly string[];
  ctaLabel?: string;
  ctaHref?: string;
}

const DEFAULT_PRICE_CENTAVOS = 3_000_000;
const ANNUAL_DISCOUNT_RATIO = 0.85;

const DEFAULT_FEATURES = [
  'Informes técnicos ilimitados con IA que cita la Res SRT',
  'EPP con planilla Res 299/11 firmada y entregada',
  'Calendario de vencimientos multi-canal (email + Telegram + push)',
  'Empleados y clientes ilimitados',
  'Registro inmutable de cada cambio (útil para ISO 45001)',
  'PDFs con tu logo y datos profesionales',
  'Soporte por WhatsApp con respuesta en horas',
] as const;

export function PricingCard({
  variant = 'full',
  priceCentavos = DEFAULT_PRICE_CENTAVOS,
  features = DEFAULT_FEATURES,
  ctaLabel = `Empezar ${TRIAL_DAYS} días gratis`,
  ctaHref = '/signup',
}: PricingCardProps) {
  const isFull = variant === 'full';
  const monthlyDisplay = formatARS(priceCentavos);
  const annualDisplay = formatARSMonthly(Math.round(priceCentavos * ANNUAL_DISCOUNT_RATIO));

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
            {monthlyDisplay}
          </span>
          <span className="text-muted-foreground text-base font-normal"> / mes</span>
        </p>
        <p className="text-muted-foreground text-sm">
          Pagando anual: <span className="text-foreground font-medium">{annualDisplay}</span>{' '}
          {/* TODO(design-system): el token `severity-ok` actual no llega a
              contrast WCAG AA 4.5:1 sobre fondo blanco (3.21 medido por
              Lighthouse). Fallback a `text-emerald-700` (~5.4:1) hasta que
              reconciliemos el token verde del design system. */}
          <span className="text-emerald-700 font-semibold">(−15%)</span>
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
