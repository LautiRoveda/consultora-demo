import type { IncidenteRow } from '../queries';
import Link from 'next/link';

import { Badge } from '@/shared/ui/badge';

import {
  formatCivilDateLongAR,
  formatTimestampEs,
  gravedadBadgeVariant,
  gravedadIncidenteLabel,
  tipoBadgeVariant,
  tipoIncidenteLabel,
} from '../labels';
import { IncidenteActionsButtons } from './IncidenteActionsButtons';

/**
 * T-063 · Header del detail view. Server component — embebe
 * `<IncidenteActionsButtons>` (client) sólo cuando el registro es vigente
 * (`esVigente`). Para versiones históricas no se ofrecen acciones.
 */
export function IncidenteDetailHeader({
  incidente,
  esVigente,
}: {
  incidente: IncidenteRow;
  esVigente: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">
          <Link href="/accidentabilidad" className="hover:text-foreground hover:underline">
            ← Volver a Accidentabilidad
          </Link>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">
            Incidente · {formatCivilDateLongAR(incidente.fecha)}
          </h1>
          <Badge variant={tipoBadgeVariant(incidente.tipo)}>
            {tipoIncidenteLabel(incidente.tipo)}
          </Badge>
          {incidente.tipo === 'accidente' && incidente.gravedad && (
            <Badge variant={gravedadBadgeVariant(incidente.gravedad)}>
              {gravedadIncidenteLabel(incidente.gravedad)}
            </Badge>
          )}
          {incidente.anulacion && <Badge variant="outline">Anulado</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">
          Registrado el {formatTimestampEs(incidente.created_at)}
        </p>
      </div>
      {esVigente && (
        <IncidenteActionsButtons
          incidenteId={incidente.id}
          tipo={incidente.tipo}
          informeId={incidente.informe_id}
          tieneCliente={incidente.cliente_id != null}
        />
      )}
    </div>
  );
}
