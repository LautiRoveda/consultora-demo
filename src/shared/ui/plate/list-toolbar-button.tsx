'use client';

/**
 * T-141 · Botón de lista (viñeta / numerada). Reusa el hook oficial
 * `useListToolbarButton` de `@platejs/list/react` — el editor usa listas
 * indent-based (ver `report-plugins.tsx`), así que el toggle del hook respeta
 * ese modelo. `nodeType` = `KEYS.ul` ('disc') o `KEYS.ol` ('decimal').
 */
import { useListToolbarButton, useListToolbarButtonState } from '@platejs/list/react';
import { useEditorReadOnly } from 'platejs/react';
import * as React from 'react';

import { ToolbarButton } from './toolbar';

export function ListToolbarButton({
  nodeType,
  label,
  children,
}: {
  nodeType: string;
  label: string;
  children: React.ReactNode;
}) {
  const readOnly = useEditorReadOnly();
  const state = useListToolbarButtonState({ nodeType });
  const { props } = useListToolbarButton(state);

  return (
    <ToolbarButton label={label} disabled={readOnly} {...props}>
      {children}
    </ToolbarButton>
  );
}
