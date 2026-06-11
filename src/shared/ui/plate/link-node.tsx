'use client';

import type { TLinkElement } from 'platejs';
import type { PlateElementProps } from 'platejs/react';
import { getLinkAttributes } from '@platejs/link';
import { PlateElement } from 'platejs/react';

export function LinkElement(props: PlateElementProps<TLinkElement>) {
  return (
    <PlateElement
      {...props}
      as="a"
      className="text-primary font-medium underline decoration-1 underline-offset-4"
      attributes={{
        ...props.attributes,
        ...getLinkAttributes(props.editor, props.element),
      }}
    >
      {props.children}
    </PlateElement>
  );
}
