import type { ChecklistTemplateListItem } from './queries';
import Link from 'next/link';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

import { CloneSystemButton } from './CloneSystemButton';
import { estadoLabel, TIPO_INSPECCION_LABELS } from './labels';
import { TemplateArchiveButton } from './TemplateArchiveButton';

interface Props {
  templates: ChecklistTemplateListItem[];
  /** Solo el owner ve las acciones de edición/archivado/clonado. */
  canEdit: boolean;
}

function tipoLabel(tipo: string): string {
  return TIPO_INSPECCION_LABELS[tipo as keyof typeof TIPO_INSPECCION_LABELS] ?? tipo;
}

export function TemplatesList({ templates, canEdit }: Props) {
  if (templates.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No hay templates para mostrar.
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {templates.map((t) => {
        const archived = t.archived_at !== null;
        const estadoVariant = t.latestVersionEstado === 'published' ? 'default' : 'secondary';
        return (
          <li
            key={t.id}
            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-foreground font-medium">{t.nombre}</p>
                {t.isSystem ? (
                  <Badge variant="outline">Sistema</Badge>
                ) : (
                  <Badge variant={estadoVariant}>
                    {estadoLabel(t.latestVersionEstado)}
                    {t.latestVersionNumber ? ` v${t.latestVersionNumber}` : ''}
                  </Badge>
                )}
                {t.hasDraft && t.latestVersionEstado !== 'draft' && (
                  <Badge variant="outline">Borrador abierto</Badge>
                )}
                {archived && <Badge variant="secondary">Archivado</Badge>}
              </div>
              <p className="text-muted-foreground text-sm">{tipoLabel(t.tipo_inspeccion)}</p>
              {t.descripcion && <p className="text-muted-foreground text-sm">{t.descripcion}</p>}
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/checklists/${t.id}`}>Abrir</Link>
              </Button>
              {canEdit && t.isSystem && <CloneSystemButton systemTemplateId={t.id} />}
              {canEdit && !t.isSystem && (
                <TemplateArchiveButton templateId={t.id} nombre={t.nombre} archived={archived} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
