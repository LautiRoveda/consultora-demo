/**
 * T-141 · Operaciones de tabla del editor (insertar/borrar fila y columna).
 *
 * Red headless de los transforms que cablea el menú contextual de celda
 * (`table-cell-dropdown.tsx`): `insertTableRow`, `insertTableColumn`, `deleteRow`,
 * `deleteColumn` de `@platejs/table`. Verifica que operan sobre la selección y que
 * el resultado SIGUE siendo GFM válido (header + fila separadora `---` intactos,
 * grilla rectangular) → el activo legal no se corrompe.
 *
 * Igual que `informe-plate-roundtrip.test.ts`: corre sin DOM (createSlateEditor)
 * con el set Base/headless de los mismos nodos que el editor real. Si la API de
 * Plate cambia los nombres de estos transforms, este test cae antes que prod.
 */
import { BaseBasicBlocksPlugin, BaseBasicMarksPlugin } from '@platejs/basic-nodes';
import { BaseListPlugin } from '@platejs/list';
import { MarkdownPlugin } from '@platejs/markdown';
import {
  BaseTableCellHeaderPlugin,
  BaseTableCellPlugin,
  BaseTablePlugin,
  BaseTableRowPlugin,
  deleteColumn,
  deleteRow,
  insertTableColumn,
  insertTableRow,
} from '@platejs/table';
import { createSlateEditor } from 'platejs';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';

const PLUGINS = [
  BaseBasicBlocksPlugin,
  BaseBasicMarksPlugin,
  BaseListPlugin,
  BaseTablePlugin.configure({ options: { disableMerge: true } }),
  BaseTableRowPlugin,
  BaseTableCellPlugin,
  BaseTableCellHeaderPlugin,
  MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } }),
];

// Tabla GFM 2 columnas × 2 filas de datos (+ header). Caso típico de mediciones.
const TABLE_MD = ['| Punto | Valor |', '| --- | --- |', '| P1 | 85 |', '| P2 | 90 |'].join('\n');

function makeEditor() {
  const editor = createSlateEditor({ plugins: PLUGINS });
  const api = editor.getApi(MarkdownPlugin).markdown;
  editor.tf.setValue(api.deserialize(TABLE_MD));
  return editor;
}

function serialize(editor: ReturnType<typeof makeEditor>): string {
  return editor.getApi(MarkdownPlugin).markdown.serialize();
}

// Selección al inicio de la primera celda de datos (fila 1, col 0). El árbol Plate
// es table[0] > tr > td > p > text; el primer leaf de la fila de datos basta para
// que getTableAbove/selection ubiquen la celda.
function selectFirstBodyCell(editor: ReturnType<typeof makeEditor>) {
  // Fila 0 = header; fila 1 = primera de datos. Celda [tabla, fila, celda, bloque, texto].
  const point = editor.api.start([0, 1, 0]);
  if (!point) throw new Error('no se pudo ubicar la primera celda de datos');
  editor.tf.select(point);
}

// Grilla de celdas (texto) por fila, parseada del markdown serializado.
function grid(md: string): string[][] {
  return md
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) =>
      l
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim()),
    );
}

// Accesores seguros (noUncheckedIndexedAccess): header = fila 0, separadora = fila 1.
const headerRow = (g: string[][]): string[] => g[0] ?? [];
const sepRow = (g: string[][]): string[] => g[1] ?? [];

describe('T-141 · operaciones de tabla (headless)', () => {
  it('parte de una tabla GFM 2×2 válida', () => {
    const g = grid(TABLE_MD);
    expect(headerRow(g)).toEqual(['Punto', 'Valor']); // header
    expect(sepRow(g).every((c) => /^-+$/.test(c))).toBe(true); // separadora
    expect(g).toHaveLength(4); // header + sep + 2 filas
  });

  it('insertar fila debajo: +1 fila de datos, separadora intacta', () => {
    const editor = makeEditor();
    selectFirstBodyCell(editor);
    insertTableRow(editor);
    const g = grid(serialize(editor));
    expect(sepRow(g).every((c) => /^-+$/.test(c))).toBe(true);
    expect(g).toHaveLength(5); // header + sep + 3 filas
    expect(g.every((row) => row.length === 2)).toBe(true); // rectangular
  });

  it('insertar fila arriba (before): +1 fila', () => {
    const editor = makeEditor();
    selectFirstBodyCell(editor);
    insertTableRow(editor, { before: true });
    expect(grid(serialize(editor))).toHaveLength(5);
  });

  it('insertar columna a la derecha: +1 columna en todas las filas', () => {
    const editor = makeEditor();
    selectFirstBodyCell(editor);
    insertTableColumn(editor);
    const g = grid(serialize(editor));
    expect(g.every((row) => row.length === 3)).toBe(true); // 3 columnas, rectangular
    expect(sepRow(g).every((c) => /^-+$/.test(c))).toBe(true); // separadora se extiende
  });

  it('insertar columna a la izquierda (before): +1 columna', () => {
    const editor = makeEditor();
    selectFirstBodyCell(editor);
    insertTableColumn(editor, { before: true });
    expect(headerRow(grid(serialize(editor)))).toHaveLength(3);
  });

  it('borrar fila: -1 fila de datos', () => {
    const editor = makeEditor();
    selectFirstBodyCell(editor);
    deleteRow(editor);
    const g = grid(serialize(editor));
    expect(g).toHaveLength(3); // header + sep + 1 fila
    expect(sepRow(g).every((c) => /^-+$/.test(c))).toBe(true);
  });

  it('borrar columna: -1 columna en todas las filas', () => {
    const editor = makeEditor();
    selectFirstBodyCell(editor);
    deleteColumn(editor);
    const g = grid(serialize(editor));
    expect(g.every((row) => row.length === 1)).toBe(true);
  });
});
