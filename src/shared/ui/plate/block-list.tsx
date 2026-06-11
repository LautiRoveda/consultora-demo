'use client';

import type { TListElement } from 'platejs';
import { isOrderedList } from '@platejs/list';
import { type PlateElementProps, type RenderNodeWrapper } from 'platejs/react';
import React from 'react';

/**
 * Render de listas para el ListPlugin indent-based. Las listas NO ordenadas se
 * renderizan vía el `inject` del plugin (display:list-item + listStyleType). Sólo
 * las ordenadas necesitan envolver en `<ol>` para que el contador numere bien.
 * (MVP T-140: sin task-lists → sin Checkbox/todo.)
 */
export const BlockList: RenderNodeWrapper = (props) => {
  if (!props.element.listStyleType) return;
  if (!isOrderedList(props.element)) return;
  return OrderedList;
};

function OrderedList(props: PlateElementProps & { lineBreakBadge?: React.ReactNode }) {
  const { listStart, listStyleType } = props.element as TListElement;
  return (
    <ol className="relative m-0 p-0" style={{ listStyleType }} start={listStart}>
      <li>
        {props.children}
        {props.lineBreakBadge}
      </li>
    </ol>
  );
}
