import type { AgenteRow } from './queries';

import { Badge } from '@/shared/ui/badge';

import { AgenteArchiveRestoreButtons } from './AgenteArchiveRestoreButtons';
import { TIPO_LABELS } from './labels';

interface Props {
  agentes: AgenteRow[];
}

export function AgentesList({ agentes }: Props) {
  if (agentes.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No hay agentes para mostrar.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {agentes.map((a) => {
        const archived = a.archived_at !== null;
        return (
          <li
            key={a.id}
            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  {a.codigo}
                </Badge>
                <p className="text-foreground font-medium">{a.nombre}</p>
                <Badge variant="secondary">{TIPO_LABELS[a.agente_tipo]}</Badge>
                {archived && <Badge variant="secondary">Archivado</Badge>}
              </div>
              <div className="text-muted-foreground space-y-1 text-sm">
                {a.cas && <p>CAS: {a.cas}</p>}
                {a.enfermedad_asociada && <p>Enfermedad: {a.enfermedad_asociada}</p>}
                {a.descripcion && <p>{a.descripcion}</p>}
              </div>
            </div>
            <AgenteArchiveRestoreButtons id={a.id} nombre={a.nombre} archived={archived} />
          </li>
        );
      })}
    </ul>
  );
}
