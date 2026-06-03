'use client';

import type { TemplateSectionNode } from '../queries';
import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader } from '@/shared/ui/card';

import { deleteSectionAction, reorderItemsAction } from '../actions';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { handleCommonFailure } from './feedback';
import { ItemEditDialog } from './ItemEditDialog';
import { ItemRow } from './ItemRow';
import { ReorderButtons } from './ReorderButtons';
import { SectionEditDialog } from './SectionEditDialog';

interface Props {
  section: TemplateSectionNode;
  index: number;
  total: number;
  onMoveSection: (direction: 'up' | 'down') => void;
  sectionsBusy: boolean;
}

export function SectionCard({ section, index, total, onMoveSection, sectionsBusy }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const items = section.items;

  function moveItem(itemIndex: number, direction: 'up' | 'down') {
    const target = direction === 'up' ? itemIndex - 1 : itemIndex + 1;
    if (target < 0 || target >= items.length) return;
    const orderedIds = items.map((i) => i.id);
    [orderedIds[itemIndex], orderedIds[target]] = [orderedIds[target]!, orderedIds[itemIndex]!];
    startTransition(async () => {
      const result = await reorderItemsAction({ sectionId: section.id, orderedIds });
      if (result.ok) {
        router.refresh();
        return;
      }
      handleCommonFailure(result, router);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-2 space-y-0">
        <ReorderButtons
          index={index}
          total={total}
          label={section.titulo}
          onMove={onMoveSection}
          disabled={sectionsBusy}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium break-words">{section.titulo}</p>
          {section.descripcion && (
            <p className="text-muted-foreground text-sm break-words">{section.descripcion}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SectionEditDialog
            mode="edit"
            sectionId={section.id}
            initialValues={{ titulo: section.titulo, descripcion: section.descripcion }}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Editar sección «${section.titulo}»`}
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
            }
          />
          <ConfirmDeleteButton
            entityLabel="esta sección"
            name={section.titulo}
            ariaLabel={`Eliminar sección «${section.titulo}»`}
            onDelete={() => deleteSectionAction({ sectionId: section.id })}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Esta sección todavía no tiene ítems.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item, i) => (
              <ItemRow
                key={item.id}
                item={item}
                index={i}
                total={items.length}
                onMove={(dir) => moveItem(i, dir)}
                disabled={isPending}
              />
            ))}
          </ul>
        )}
        <ItemEditDialog
          mode="create"
          sectionId={section.id}
          trigger={
            <Button type="button" variant="outline" size="sm">
              <Plus className="mr-2 size-4" aria-hidden />
              Agregar ítem
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}
