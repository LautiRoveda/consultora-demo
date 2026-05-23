import type { CategoriaRow } from './queries';

import { Badge } from '@/shared/ui/badge';

import { ArchiveRestoreButtons } from './ArchiveRestoreButtons';

interface Props {
  categorias: CategoriaRow[];
}

export function CategoriasList({ categorias }: Props) {
  if (categorias.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No hay categorías para mostrar.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {categorias.map((c) => {
        const archived = c.archived_at !== null;
        return (
          <li
            key={c.id}
            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-foreground font-medium">{c.nombre}</p>
                {archived && <Badge variant="secondary">Archivada</Badge>}
              </div>
              {c.descripcion && <p className="text-muted-foreground text-sm">{c.descripcion}</p>}
            </div>
            <ArchiveRestoreButtons
              entity="categoria"
              id={c.id}
              nombre={c.nombre}
              archived={archived}
            />
          </li>
        );
      })}
    </ul>
  );
}
