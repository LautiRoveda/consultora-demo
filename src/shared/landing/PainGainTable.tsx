import { ArrowRightIcon } from 'lucide-react';

/**
 * T-108 · Tabla 2 columnas "Sin/Con" para landing + "Hoy/Con" para /precios.
 *
 * Server Component. Mobile-first: en pantallas <md renderiza cards apiladas
 * con flecha (una tabla de 2 columnas en 375px es infierno de tap target);
 * en >=md renderiza una tabla con header dest acado en columna derecha.
 *
 * Las dos variantes solo difieren en los headers — el shape de filas es el
 * mismo, así que el discriminator es un prop simple en lugar de un union.
 */

export type PainGainVariant = 'landing' | 'precios';

export interface PainGainRow {
  pain: string;
  gain: string;
}

interface PainGainTableProps {
  variant: PainGainVariant;
  rows: readonly PainGainRow[];
}

const HEADERS: Record<PainGainVariant, { pain: string; gain: string }> = {
  landing: { pain: 'Sin ConsultoraDemo', gain: 'Con ConsultoraDemo' },
  precios: { pain: 'Hoy', gain: 'Con ConsultoraDemo' },
};

export function PainGainTable({ variant, rows }: PainGainTableProps) {
  const { pain: painHeader, gain: gainHeader } = HEADERS[variant];

  return (
    <div className="mx-auto max-w-4xl">
      {/* Desktop / tablet: tabla 2 columnas. */}
      <div className="bg-card hidden overflow-hidden rounded-lg border md:block">
        <div className="bg-muted/50 grid grid-cols-2 border-b">
          <div className="text-muted-foreground px-6 py-3 text-sm font-medium">{painHeader}</div>
          <div className="bg-primary/5 text-primary px-6 py-3 text-sm font-semibold">
            {gainHeader}
          </div>
        </div>
        {rows.map((row, idx) => (
          <div
            key={row.pain}
            className={`grid grid-cols-2 ${idx < rows.length - 1 ? 'border-b' : ''}`}
          >
            <div className="text-muted-foreground px-6 py-4 text-sm leading-relaxed">
              {row.pain}
            </div>
            <div className="bg-primary/5 text-foreground px-6 py-4 text-sm leading-relaxed">
              {row.gain}
            </div>
          </div>
        ))}
      </div>

      {/* Mobile: cards apiladas con flecha vertical. */}
      <div className="space-y-4 md:hidden">
        {rows.map((row) => (
          <div key={row.pain} className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {painHeader}
            </p>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{row.pain}</p>
            <div className="my-3 flex items-center gap-2">
              <ArrowRightIcon className="text-primary size-4" aria-hidden="true" />
              <p className="text-primary text-xs font-semibold uppercase tracking-wide">
                {gainHeader}
              </p>
            </div>
            <p className="text-foreground text-sm leading-relaxed">{row.gain}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
