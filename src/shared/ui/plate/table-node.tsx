'use client';

import type { PlateElementProps } from 'platejs/react';
import { PlateElement } from 'platejs/react';

import { TableCellDropdown } from './table-cell-dropdown';

/**
 * Tabla mínima (sin drag handles / resize → sin @platejs/dnd ni radix sueltos).
 * Edición de celdas vía contentEditable. T-141 sumó el menú contextual de
 * operaciones (insertar/borrar fila y columna) por celda. El round-trip GFM
 * (activo legal) está cubierto por el test de CI; `disableMerge` en el plugin
 * mantiene las tablas GFM-puras (sin rowspan/colspan que GFM no representa).
 */
export function TableElement(props: PlateElementProps) {
  // PlateElement es el wrapper (lleva data-slate-node); adentro va una <table>
  // real con <tbody> conteniendo los rows (igual que el node-component de Plate).
  // Mobile: `min-w-[480px]` evita que las columnas se aplasten ilegibles a 375px
  // y hace que `overflow-x-auto` del wrapper scrollee; `sm:min-w-0` vuelve fluida
  // (`w-full`) en desktop. El min-w va EN la <table> (no en un <div> intermedio)
  // para no insertar DOM entre PlateElement y los children Slate → contenteditable
  // intacto (mismo árbol que prod, solo cambia el className).
  return (
    <PlateElement {...props} className="my-4 overflow-x-auto">
      <table className="border-border w-full min-w-[480px] border-collapse border text-sm sm:min-w-0">
        <tbody>{props.children}</tbody>
      </table>
    </PlateElement>
  );
}

export function TableRowElement(props: PlateElementProps) {
  return <PlateElement {...props} as="tr" />;
}

export function TableCellElement(props: PlateElementProps) {
  // `relative group/cell`: ancla el trigger absoluto del dropdown y habilita el
  // reveal on-hover en desktop. El dropdown es hijo extra (contentEditable=false)
  // junto a los children Slate, NO entre PlateElement y ellos.
  return (
    <PlateElement
      {...props}
      as="td"
      className="group/cell border-border relative border px-3 py-2 align-top"
    >
      {props.children}
      <TableCellDropdown element={props.element} />
    </PlateElement>
  );
}

export function TableCellHeaderElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="th"
      className="group/cell border-border bg-muted/50 relative border px-3 py-2 text-left font-semibold"
    >
      {props.children}
      <TableCellDropdown element={props.element} />
    </PlateElement>
  );
}
