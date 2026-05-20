import type { InformeListRow } from './queries';
import type { InformeStatus, InformeTipo } from './schema';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

import { INFORME_STATUS_LABELS, INFORME_TIPO_LABELS } from './schema';

/**
 * T-019 · Render de la lista de informes.
 *
 * Server Component (sin interactividad en T-019 — cada row es un Link).
 * Filtros, paginacion y bulk-actions llegan en T-025+.
 *
 * El cast a InformeTipo/InformeStatus es seguro: la DB tiene check constraint,
 * el INSERT pasa por Zod, y los labels cubren TODOS los miembros del union.
 * Si la DB devolviera un valor fuera de spec sería un bug — el render hace
 * fallback al valor crudo.
 */
export function InformesList({ informes }: { informes: InformeListRow[] }) {
  if (informes.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="space-y-1">
            <p className="text-foreground text-sm font-medium">Todavía no tenés informes</p>
            <p className="text-muted-foreground max-w-md text-sm">
              Empezá creando tu primer informe. Vas a poder generarlo con IA en menos de 5 minutos.
            </p>
          </div>
          <Button asChild>
            <Link href="/informes/nuevo">Crear primer informe</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {informes.map((informe) => {
        const tipoLabel = INFORME_TIPO_LABELS[informe.tipo as InformeTipo] ?? informe.tipo;
        const statusLabel =
          INFORME_STATUS_LABELS[informe.status as InformeStatus] ?? informe.status;
        return (
          <li key={informe.id}>
            <Link
              href={`/informes/${informe.id}`}
              className="hover:bg-accent block rounded-lg border p-4 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-foreground font-medium">{informe.titulo}</p>
                  <p className="text-muted-foreground text-sm">
                    {tipoLabel} · {statusLabel}
                  </p>
                </div>
                <time
                  dateTime={informe.created_at}
                  className="text-muted-foreground shrink-0 text-sm"
                >
                  {new Date(informe.created_at).toLocaleDateString('es-AR', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </time>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
