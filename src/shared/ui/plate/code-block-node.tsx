'use client';

import type { PlateElementProps } from 'platejs/react';
import { PlateElement } from 'platejs/react';

/**
 * MVP: bloque de código sin syntax highlighting (sin lowlight) ni selector de
 * lenguaje. El markdown se preserva igual; el highlight es pulido de follow-up.
 */
export function CodeBlockElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="py-1">
      <pre className="bg-muted/50 overflow-x-auto rounded-md p-4 font-mono text-sm [tab-size:2]">
        <code>{props.children}</code>
      </pre>
    </PlateElement>
  );
}

export function CodeLineElement(props: PlateElementProps) {
  return <PlateElement {...props} />;
}
