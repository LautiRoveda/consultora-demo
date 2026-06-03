'use client';

import type { TemplateItemRow } from '../queries';
import { Pencil } from 'lucide-react';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

import { deleteItemAction } from '../actions';
import { RESPONSE_TYPE_LABELS } from '../labels';
import { type ResponseType } from '../schema';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { ItemEditDialog } from './ItemEditDialog';
import { ReorderButtons } from './ReorderButtons';

interface Props {
  item: TemplateItemRow;
  index: number;
  total: number;
  onMove: (direction: 'up' | 'down') => void;
  disabled: boolean;
}

export function ItemRow({ item, index, total, onMove, disabled }: Props) {
  const responseLabel =
    RESPONSE_TYPE_LABELS[item.response_type as ResponseType] ?? item.response_type;

  return (
    <li className="flex items-start gap-2 rounded-md border p-3">
      <ReorderButtons
        index={index}
        total={total}
        label={item.texto}
        onMove={onMove}
        disabled={disabled}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm break-words">{item.texto}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{responseLabel}</Badge>
          {item.es_critico && <Badge variant="destructive">Crítico</Badge>}
          {!item.es_requerido && <Badge variant="secondary">Opcional</Badge>}
          {item.referencia_normativa && (
            <span className="text-muted-foreground text-xs">{item.referencia_normativa}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ItemEditDialog
          mode="edit"
          itemId={item.id}
          initialValues={{
            texto: item.texto,
            response_type: item.response_type as ResponseType,
            es_critico: item.es_critico,
            es_requerido: item.es_requerido,
            referencia_normativa: item.referencia_normativa,
          }}
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={disabled}
              aria-label={`Editar ítem «${item.texto}»`}
            >
              <Pencil className="size-4" aria-hidden />
            </Button>
          }
        />
        <ConfirmDeleteButton
          entityLabel="este ítem"
          name={item.texto}
          ariaLabel={`Eliminar ítem «${item.texto}»`}
          onDelete={() => deleteItemAction({ itemId: item.id })}
        />
      </div>
    </li>
  );
}
