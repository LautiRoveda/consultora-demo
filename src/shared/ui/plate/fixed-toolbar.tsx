'use client';

/**
 * T-141 · Toolbar fija (siempre visible) del editor de informes. Decisión del
 * ticket: fixed > floating → descubrible para consultores no técnicos. Se monta
 * DENTRO de `<Plate>` (necesita el contexto del editor) y sticky al tope del
 * scroll de la página. Los botones se deshabilitan solos vía `useEditorReadOnly`.
 *
 * Todos los toggles son transforms sobre el árbol Plate → no tocan el round-trip
 * ni el bridge (serialize/deserialize remark-gfm intacto).
 */
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from 'lucide-react';
import { KEYS } from 'platejs';
import * as React from 'react';

import { BlockToolbarButton } from './block-toolbar-button';
import { LinkToolbarButton } from './link-toolbar-button';
import { ListToolbarButton } from './list-toolbar-button';
import { MarkToolbarButton } from './mark-toolbar-button';
import { Toolbar, ToolbarSeparator } from './toolbar';

export function FixedToolbar() {
  return (
    <Toolbar className="sticky top-0 z-10 rounded-t-md border-x border-t bg-background/95 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <BlockToolbarButton nodeType={KEYS.h1} label="Título 1">
        <Heading1 />
      </BlockToolbarButton>
      <BlockToolbarButton nodeType={KEYS.h2} label="Título 2">
        <Heading2 />
      </BlockToolbarButton>
      <BlockToolbarButton nodeType={KEYS.h3} label="Título 3">
        <Heading3 />
      </BlockToolbarButton>

      <ToolbarSeparator />

      <MarkToolbarButton nodeType={KEYS.bold} label="Negrita (Ctrl+B)">
        <Bold />
      </MarkToolbarButton>
      <MarkToolbarButton nodeType={KEYS.italic} label="Itálica (Ctrl+I)">
        <Italic />
      </MarkToolbarButton>
      <MarkToolbarButton nodeType={KEYS.strikethrough} label="Tachado">
        <Strikethrough />
      </MarkToolbarButton>
      <MarkToolbarButton nodeType={KEYS.code} label="Código en línea">
        <Code />
      </MarkToolbarButton>

      <ToolbarSeparator />

      <ListToolbarButton nodeType={KEYS.ul} label="Lista de viñetas">
        <List />
      </ListToolbarButton>
      <ListToolbarButton nodeType={KEYS.ol} label="Lista numerada">
        <ListOrdered />
      </ListToolbarButton>

      <ToolbarSeparator />

      <BlockToolbarButton nodeType={KEYS.blockquote} label="Cita">
        <Quote />
      </BlockToolbarButton>
      <LinkToolbarButton />
    </Toolbar>
  );
}
