'use client';

/**
 * T-141 · Botón de bloque (títulos H1-H3 / cita). `toggleBlock` setea/quita el
 * tipo del bloque en la selección; `pressed` se deriva con `api.some({ match })`
 * reactivo al cursor. Mismo patrón anti-robo-de-foco que las marcas.
 */
import { useEditorReadOnly, useEditorRef, useEditorSelector } from 'platejs/react';
import * as React from 'react';

import { ToolbarButton } from './toolbar';

export function BlockToolbarButton({
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
  const pressed = useEditorSelector((ed) => ed.api.some({ match: { type: nodeType } }), [nodeType]);

  return (
    <ToolbarButton
      label={label}
      pressed={pressed}
      disabled={readOnly}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => editor.tf.toggleBlock(nodeType)}
    >
      {children}
    </ToolbarButton>
  );
}
