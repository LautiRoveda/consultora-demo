import type { PuestoRow } from './queries';

import { Badge } from '@/shared/ui/badge';

import { ArchiveRestoreButtons } from './ArchiveRestoreButtons';

interface Props {
  puestos: PuestoRow[];
}

export function PuestosList({ puestos }: Props) {
  if (puestos.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No hay puestos para mostrar.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {puestos.map((p) => {
        const archived = p.archived_at !== null;
        const riesgos = p.riesgos_asociados ?? [];
        return (
          <li
            key={p.id}
            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-foreground font-medium">{p.nombre}</p>
                {archived && <Badge variant="secondary">Archivado</Badge>}
              </div>
              {p.descripcion && <p className="text-muted-foreground text-sm">{p.descripcion}</p>}
              {riesgos.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {riesgos.map((r) => (
                    <Badge key={r} variant="outline" className="font-normal">
                      {r}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <ArchiveRestoreButtons
              entity="puesto"
              id={p.id}
              nombre={p.nombre}
              archived={archived}
            />
          </li>
        );
      })}
    </ul>
  );
}
