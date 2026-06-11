'use client';

/**
 * T-140 · Set de plugins del editor de informes. Instalación quirúrgica:
 * solo los nodos que un informe usa (sin toolbar/comments/suggestions/ai/media),
 * sin @platejs/dnd ni @radix-ui individuales. Serializador = remark-gfm ÚNICO,
 * alineado con `@/shared/ui/markdown` (preview) y `PrintTemplate` (PDF).
 *
 * ⚠️ SYNC: el test de round-trip `src/tests/unit/informe-plate-roundtrip.test.ts`
 * usa el set Base/headless equivalente de estos mismos nodos. Si agregás/sacás un
 * nodo acá, reflejalo allá (y viceversa) — si no, el test de CI deja de cubrir el
 * editor real.
 */
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from '@platejs/basic-nodes/react';
import { CodeBlockPlugin, CodeLinePlugin } from '@platejs/code-block/react';
import { IndentPlugin } from '@platejs/indent/react';
import { LinkPlugin } from '@platejs/link/react';
import { isOrderedList } from '@platejs/list';
import { ListPlugin } from '@platejs/list/react';
import { MarkdownPlugin } from '@platejs/markdown';
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from '@platejs/table/react';
import { KEYS } from 'platejs';
import { ParagraphPlugin } from 'platejs/react';
import remarkGfm from 'remark-gfm';

import { BlockList } from './block-list';
import { BlockquoteElement } from './blockquote-node';
import { CodeBlockElement, CodeLineElement } from './code-block-node';
import { CodeLeaf } from './code-node';
import { H1Element, H2Element, H3Element } from './heading-node';
import { HrElement } from './hr-node';
import { LinkElement } from './link-node';
import { ParagraphElement } from './paragraph-node';
import {
  TableCellElement,
  TableCellHeaderElement,
  TableElement,
  TableRowElement,
} from './table-node';

const INDENT_TARGETS = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock];

export const REPORT_EDITOR_PLUGINS = [
  ParagraphPlugin.withComponent(ParagraphElement),
  H1Plugin.withComponent(H1Element),
  H2Plugin.withComponent(H2Element),
  H3Plugin.withComponent(H3Element),
  BlockquotePlugin.withComponent(BlockquoteElement),
  HorizontalRulePlugin.withComponent(HrElement),
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  CodePlugin.withComponent(CodeLeaf),
  LinkPlugin.configure({ render: { node: LinkElement } }),
  IndentPlugin.configure({
    inject: { targetPlugins: INDENT_TARGETS },
    options: { offset: 24 },
  }),
  ListPlugin.configure({
    inject: {
      nodeProps: {
        nodeKey: KEYS.listType,
        query: ({ nodeProps }) => {
          const element = nodeProps.element;
          return !!element?.listStyleType && !isOrderedList(element);
        },
        transformProps: ({ props }) => ({
          ...props,
          role: 'listitem',
          style: { ...props.style, display: 'list-item' },
        }),
      },
      targetPlugins: INDENT_TARGETS,
    },
    render: { belowNodes: BlockList },
  }),
  CodeBlockPlugin.withComponent(CodeBlockElement),
  CodeLinePlugin.withComponent(CodeLineElement),
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(TableRowElement),
  TableCellPlugin.withComponent(TableCellElement),
  TableCellHeaderPlugin.withComponent(TableCellHeaderElement),
  MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } }),
];
