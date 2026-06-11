'use client';

/**
 * T-141 · Menú contextual de operaciones de tabla, anclado en la celda. Cubre el
 * gap funcional que hoy obliga a ir a source-mode: insertar/borrar fila y columna.
 *
 * Usa los helpers estáticos de `@platejs/table` (insertTableRow/Column, deleteRow/
 * Column) — tipados sin depender de la augmentación de `editor.tf`. Todos operan
 * sobre la selección del editor, así que antes de cada operación movemos la
 * selección a ESTA celda (`select(start(path))`): clickear el menú no garantiza
 * que el cursor esté en la celda correcta.
 *
 * El trigger es `contentEditable={false}` y vive como hijo extra del `<td>` (junto
 * a los children Slate, NO entre PlateElement y ellos) → mismo patrón que la UI de
 * celda de Plate; contenteditable intacto.
 */
import { deleteColumn, deleteRow, insertTableColumn, insertTableRow } from '@platejs/table';
import { ChevronDown } from 'lucide-react';
import { type TElement } from 'platejs';
import { useEditorReadOnly, useEditorRef } from 'platejs/react';
import * as React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';

export function TableCellDropdown({ element }: { element: TElement }) {
  const editor = useEditorRef();
  const readOnly = useEditorReadOnly();

  // En readonly (preview/disabled) no hay edición → sin menú.
  if (readOnly) return null;

  function run(op: () => void) {
    const path = editor.api.findPath(element);
    if (!path) return;
    editor.tf.select(editor.api.start(path)); // selección a esta celda
    op();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          contentEditable={false}
          aria-label="Opciones de celda"
          // En táctil/coarse siempre visible (no hay hover); en desktop+mouse se
          // revela on-hover/focus para no ensuciar la tabla (patrón híbrido T-127).
          className="absolute end-0.5 top-0.5 inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground opacity-100 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:opacity-0 md:pointer-fine:group-hover/cell:opacity-100"
        >
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" contentEditable={false}>
        <DropdownMenuItem onSelect={() => run(() => insertTableRow(editor, { before: true }))}>
          Insertar fila arriba
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(() => insertTableRow(editor))}>
          Insertar fila abajo
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(() => insertTableColumn(editor, { before: true }))}>
          Insertar columna a la izquierda
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(() => insertTableColumn(editor))}>
          Insertar columna a la derecha
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => run(() => deleteRow(editor))}>
          Borrar fila
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => run(() => deleteColumn(editor))}>
          Borrar columna
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
