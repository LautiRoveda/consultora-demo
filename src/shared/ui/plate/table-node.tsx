'use client';

import type { PlateElementProps } from 'platejs/react';
import { PlateElement } from 'platejs/react';

/**
 * MVP: tabla mínima (sin drag handles / resize / menús de columna → sin
 * @platejs/dnd ni radix individuales). Edición de celdas vía contentEditable.
 * El round-trip GFM (activo legal) está cubierto por el test de CI.
 */
export function TableElement(props: PlateElementProps) {
  // PlateElement es el wrapper (lleva data-slate-node); adentro va una <table>
  // real con <tbody> conteniendo los rows (igual que el node-component de Plate).
  return (
    <PlateElement {...props} className="my-4 overflow-x-auto">
      <table className="border-border w-full border-collapse border text-sm">
        <tbody>{props.children}</tbody>
      </table>
    </PlateElement>
  );
}

export function TableRowElement(props: PlateElementProps) {
  return <PlateElement {...props} as="tr" />;
}

export function TableCellElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="td" className="border-border border px-3 py-2 align-top">
      {props.children}
    </PlateElement>
  );
}

export function TableCellHeaderElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="th"
      className="border-border bg-muted/50 border px-3 py-2 text-left font-semibold"
    >
      {props.children}
    </PlateElement>
  );
}
