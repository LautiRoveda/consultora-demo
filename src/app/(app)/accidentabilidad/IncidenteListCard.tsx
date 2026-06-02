import type { IncidenteVigente } from './queries';
import Link from 'next/link';

import { Badge } from '@/shared/ui/badge';

import {
  formatCivilDateShortAR,
  gravedadBadgeVariant,
  gravedadIncidenteLabel,
  tipoBadgeVariant,
  tipoIncidenteLabel,
} from './labels';

/**
 * T-063 · Card de un incidente vigente en el listado. Calca `ClienteListCard`:
 * densidad fija + placeholders `'—'`. Los campos vienen de la vista
 * `incidentes_vigentes` (tipos nullable) → guardas defensivas en cada slot.
 */
export function IncidenteListCard({
  incidente,
  clienteNombre,
}: {
  incidente: IncidenteVigente;
  clienteNombre?: string;
}) {
  const id = incidente.id ?? '';
  return (
    <Link
      href={`/accidentabilidad/${id}`}
      className="hover:bg-accent block rounded-lg border p-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {incidente.tipo && (
              <Badge variant={tipoBadgeVariant(incidente.tipo)}>
                {tipoIncidenteLabel(incidente.tipo)}
              </Badge>
            )}
            {incidente.tipo === 'accidente' && incidente.gravedad && (
              <Badge variant={gravedadBadgeVariant(incidente.gravedad)}>
                {gravedadIncidenteLabel(incidente.gravedad)}
              </Badge>
            )}
          </div>
          <p className="text-foreground line-clamp-1 font-medium">{incidente.descripcion ?? '—'}</p>
          <p className="text-muted-foreground text-xs">
            {clienteNombre ?? 'Sin cliente'} · {incidente.lugar_especifico ?? '—'}
          </p>
        </div>
        {incidente.fecha && (
          <time className="text-muted-foreground shrink-0 text-xs" dateTime={incidente.fecha}>
            {formatCivilDateShortAR(incidente.fecha)}
          </time>
        )}
      </div>
    </Link>
  );
}
