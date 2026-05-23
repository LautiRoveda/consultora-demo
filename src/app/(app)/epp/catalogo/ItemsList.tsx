import type { ItemWithCategoria } from './queries';

import { Badge } from '@/shared/ui/badge';

import { ArchiveRestoreButtons } from './ArchiveRestoreButtons';

interface Props {
  items: ItemWithCategoria[];
}

export function ItemsList({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No hay items para mostrar.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((it) => {
        const archived = it.archived_at !== null;
        return (
          <li
            key={it.id}
            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-foreground font-medium">{it.nombre}</p>
                {archived && <Badge variant="secondary">Archivado</Badge>}
                {it.es_descartable && <Badge variant="outline">Descartable</Badge>}
                {it.requiere_numero_serie && <Badge variant="outline">N° de serie</Badge>}
              </div>
              <p className="text-muted-foreground text-sm">
                {it.categoria_nombre} ·{' '}
                {it.es_descartable
                  ? 'Sin renovación planificada'
                  : `Vida útil ${it.vida_util_meses} m`}
                {it.normativa && ` · ${it.normativa}`}
              </p>
              {(it.marca_default || it.modelo_default) && (
                <p className="text-muted-foreground text-xs">
                  {it.marca_default ?? '—'}
                  {it.modelo_default ? ` / ${it.modelo_default}` : ''}
                </p>
              )}
            </div>
            <ArchiveRestoreButtons
              entity="item"
              id={it.id}
              nombre={it.nombre}
              archived={archived}
            />
          </li>
        );
      })}
    </ul>
  );
}
