/**
 * T-140 · Test de round-trip markdown ↔ Plate (red automática anti-pérdida).
 *
 * El editor de informes serializa con el MISMO `remark-gfm` que el render
 * (`@/shared/ui/markdown`) y el PDF (`PrintTemplate`). Este test corre el
 * round-trip HEADLESS (sin DOM, en el proyecto `unit`) sobre un informe real y
 * verifica que NO haya pérdida de contenido contra el render canónico.
 *
 * Política de igualdad (decidida en el spike T-140):
 *  - ESTRICTO en tablas (activo legal), placeholders, texto e idempotencia.
 *  - TOLERANTE a la normalización loose→tight de listas que hace Plate
 *    (cambia el wrapper `<p>`-en-`<li>` y el agrupamiento `<ol>`/`<ul>`, sin
 *    perder contenido). Se excluyen P/OL/UL del multiset estructural, pero el
 *    conteo de `<li>` sigue estricto → un ítem perdido igual falla.
 *
 * Fixture en `.txt` (no `.md`) para que el pre-commit prettier no la reformatee.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseBasicBlocksPlugin, BaseBasicMarksPlugin } from '@platejs/basic-nodes';
import { BaseCodeBlockPlugin, BaseCodeLinePlugin } from '@platejs/code-block';
import { BaseLinkPlugin } from '@platejs/link';
import { BaseListPlugin } from '@platejs/list';
import { MarkdownPlugin } from '@platejs/markdown';
import {
  BaseTableCellHeaderPlugin,
  BaseTableCellPlugin,
  BaseTablePlugin,
  BaseTableRowPlugin,
} from '@platejs/table';
import { JSDOM } from 'jsdom';
import { createSlateEditor } from 'platejs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';

import { Markdown } from '@/shared/ui/markdown';

// ⚠️ SYNC: este set Base/headless debe cubrir los MISMOS nodos que
// `REPORT_EDITOR_PLUGINS` (variantes React) en src/shared/ui/plate/report-plugins.tsx.
// Si cambiás uno, cambiá el otro — si no, este round-trip deja de cubrir el editor real.
const REPORT_PLUGINS = [
  BaseBasicBlocksPlugin,
  BaseBasicMarksPlugin,
  BaseListPlugin,
  BaseLinkPlugin,
  BaseCodeBlockPlugin,
  BaseCodeLinePlugin,
  BaseTablePlugin,
  BaseTableRowPlugin,
  BaseTableCellPlugin,
  BaseTableCellHeaderPlugin,
  MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } }),
];

function roundTrip(md: string): string {
  const editor = createSlateEditor({ plugins: REPORT_PLUGINS });
  const api = editor.getApi(MarkdownPlugin).markdown;
  return api.serialize({ value: api.deserialize(md) });
}

function bodyOf(html: string): HTMLElement {
  return new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document.body;
}

function renderBody(md: string): HTMLElement {
  return bodyOf(renderToStaticMarkup(createElement(Markdown, { content: md })));
}

// Normaliza whitespace inter-bloque y quita el U+200B que Plate mete en celdas vacías.
function norm(t: string | null): string {
  return (t ?? '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
}

function textOf(body: HTMLElement): string {
  return norm(body.textContent);
}

// Cada tabla como matriz de textos de celda (comparación estricta del activo legal).
function tablesOf(body: HTMLElement): string[][][] {
  return Array.from(body.querySelectorAll('table')).map((table) =>
    Array.from(table.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((cell) => norm(cell.textContent)),
    ),
  );
}

function tagMultiset(body: HTMLElement, exclude: Set<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const el of Array.from(body.querySelectorAll('*'))) {
    if (exclude.has(el.tagName)) continue;
    counts[el.tagName] = (counts[el.tagName] ?? 0) + 1;
  }
  return counts;
}

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'informe-real-t138.txt'),
  'utf8',
);

describe('T-140 · round-trip markdown ↔ Plate (informe real)', () => {
  const rt = roundTrip(FIXTURE);
  const origBody = renderBody(FIXTURE);
  const rtBody = renderBody(rt);

  it('es idempotente (converge tras un pase)', () => {
    expect(roundTrip(rt)).toBe(rt);
  });

  it('no pierde contenido: texto renderizado idéntico', () => {
    expect(textOf(rtBody)).toBe(textOf(origBody));
  });

  it('tablas idénticas — estricto (activo legal)', () => {
    expect(tablesOf(rtBody)).toEqual(tablesOf(origBody));
  });

  it('placeholders [..] sobreviven', () => {
    const tokens = [...new Set(FIXTURE.match(/\[[^\]\n]+\]/g) ?? [])];
    const rendered = textOf(rtBody);
    const missing = tokens.filter((t) => !rendered.includes(t));
    expect(missing).toEqual([]);
  });

  it('estructura no-lista idéntica — tolerante a looseness de listas', () => {
    const exclude = new Set(['P', 'OL', 'UL']);
    expect(tagMultiset(rtBody, exclude)).toEqual(tagMultiset(origBody, exclude));
  });

  it('no se pierden ítems de lista (conteo <li> estricto)', () => {
    expect(rtBody.querySelectorAll('li').length).toBe(origBody.querySelectorAll('li').length);
  });
});
