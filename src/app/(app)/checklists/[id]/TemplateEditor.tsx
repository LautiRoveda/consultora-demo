'use client';

import type { TemplateSectionNode } from '../queries';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

import { reorderSectionsAction } from '../actions';
import { type TipoInspeccion } from '../schema';
import { handleCommonFailure } from './feedback';
import { PublishButton } from './PublishButton';
import { SectionCard } from './SectionCard';
import { SectionEditDialog } from './SectionEditDialog';
import { TemplateMetaDialog } from './TemplateMetaDialog';

interface Props {
  templateId: string;
  versionId: string;
  versionNumber: number;
  nombre: string;
  descripcion: string | null;
  tipoInspeccion: TipoInspeccion;
  sections: TemplateSectionNode[];
}

export function TemplateEditor({
  templateId,
  versionId,
  versionNumber,
  nombre,
  descripcion,
  tipoInspeccion,
  sections,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const itemCount = sections.reduce((acc, s) => acc + s.items.length, 0);

  function moveSection(index: number, direction: 'up' | 'down') {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= sections.length) return;
    const orderedIds = sections.map((s) => s.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target]!, orderedIds[index]!];
    startTransition(async () => {
      const result = await reorderSectionsAction({ versionId, orderedIds });
      if (result.ok) {
        router.refresh();
        return;
      }
      handleCommonFailure(result, router);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Borrador v{versionNumber}</Badge>
          <TemplateMetaDialog
            templateId={templateId}
            initialValues={{ nombre, descripcion, tipo_inspeccion: tipoInspeccion }}
          />
        </div>
        <PublishButton versionId={versionId} itemCount={itemCount} />
      </div>

      {sections.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          Todavía no hay secciones. Agregá la primera para empezar a cargar ítems.
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map((section, i) => (
            <SectionCard
              key={section.id}
              section={section}
              index={i}
              total={sections.length}
              onMoveSection={(dir) => moveSection(i, dir)}
              sectionsBusy={isPending}
            />
          ))}
        </div>
      )}

      <SectionEditDialog
        mode="create"
        versionId={versionId}
        trigger={
          <Button type="button" variant="outline">
            <Plus className="mr-2 size-4" aria-hidden />
            Agregar sección
          </Button>
        }
      />
    </div>
  );
}
