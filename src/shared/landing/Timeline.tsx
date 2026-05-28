/**
 * T-108 · Timeline 4 pasos reutilizable.
 *
 * Server Component. Dos variants:
 *  - `semana`: lun/mar/mié/jue — cómo se ve la semana operando con
 *    ConsultoraDemo. Sin tiempos, cada paso lleva el día de la semana.
 *  - `onboarding`: tu primer día — pasos con tiempo estimado (min/seg) para
 *    bajar fricción percibida de empezar.
 *
 * Layout: timeline vertical en mobile (línea + dots a la izquierda), grid
 * horizontal 4-col en md+ (línea horizontal con dots numerados arriba).
 */

export type TimelineVariant = 'semana' | 'onboarding';

export interface TimelineStep {
  /** Etiqueta corta arriba del título (día de la semana o tiempo). */
  badge: string;
  title: string;
  body: string;
}

interface TimelineProps {
  variant: TimelineVariant;
  steps: readonly TimelineStep[];
}

export function Timeline({ variant, steps }: TimelineProps) {
  const badgeTone =
    variant === 'onboarding' ? 'bg-severity-ok/15 text-severity-ok' : 'bg-primary/10 text-primary';

  return (
    <div data-variant={variant} data-testid={`timeline-${variant}`} className="mx-auto max-w-5xl">
      {/* Desktop: grid horizontal con línea conectora. */}
      <ol className="hidden md:grid md:grid-cols-4 md:gap-6">
        {steps.map((step, idx) => (
          <li key={step.title} className="relative">
            <div className="flex items-center gap-3">
              <span
                className={`bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold`}
              >
                {idx + 1}
              </span>
              {idx < steps.length - 1 ? (
                <span className="bg-primary/20 h-px flex-1" aria-hidden="true" />
              ) : null}
            </div>
            <p
              className={`${badgeTone} mt-4 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium`}
            >
              {step.badge}
            </p>
            <h3 className="mt-2 text-base font-semibold leading-snug">{step.title}</h3>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{step.body}</p>
          </li>
        ))}
      </ol>

      {/* Mobile: timeline vertical con línea + dots a la izquierda. */}
      <ol className="space-y-6 md:hidden">
        {steps.map((step, idx) => (
          <li key={step.title} className="relative pl-12">
            <span className="bg-primary text-primary-foreground absolute left-0 top-0 flex size-8 items-center justify-center rounded-full text-sm font-semibold">
              {idx + 1}
            </span>
            {idx < steps.length - 1 ? (
              <span
                className="bg-primary/20 absolute left-4 top-9 -ml-px h-full w-0.5"
                aria-hidden="true"
              />
            ) : null}
            <p
              className={`${badgeTone} inline-block rounded-full px-2.5 py-0.5 text-xs font-medium`}
            >
              {step.badge}
            </p>
            <h3 className="mt-2 text-base font-semibold leading-snug">{step.title}</h3>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
