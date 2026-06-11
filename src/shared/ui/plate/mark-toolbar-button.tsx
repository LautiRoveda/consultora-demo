'use client';

/**
 * T-141 · Botón de marca inline (negrita / itálica / tachado / código).
 *
 * No hay hook de toolbar de marcas en la lib v53 (los `*ToolbarButton` son código
 * del registry shadcn, no exports) → lo armamos sobre las APIs core: `toggleMark`
 * para el toggle y `useEditorSelector` para el estado `pressed` reactivo al cursor.
 *
 * `onMouseDown preventDefault`: clickear el botón NO debe robar foco ni colapsar
 * la selección del editor — el toggle opera sobre la selección viva.
 */
import { useEditorReadOnly, useEditorRef, useEditorSelector } from 'platejs/react';
import * as React from 'react';

import { ToolbarButton } from './toolbar';

export function MarkToolbarButton({
  nodeType,
  label,
  children,
}: {
  nodeType: string;
  label: string;
  children: React.ReactNode;
}) {
  const editor = useEditorRef();
  const readOnly = useEditorReadOnly();
  const pressed = useEditorSelector((ed) => !!ed.api.marks()?.[nodeType], [nodeType]);

  return (
    <ToolbarButton
      label={label}
      pressed={pressed}
      disabled={readOnly}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => editor.tf.toggleMark(nodeType)}
    >
      {children}
    </ToolbarButton>
  );
}
