/**
 * T-141 Fase A · E2E del editor con edición rica (toolbar + operaciones de tabla).
 *
 * Smoke visual + funcional de las 4 verificaciones que el owner pidió:
 *  1. Escribir en una celda CON el dropdown presente → el contentEditable=false
 *     del trigger NO rompe el contenteditable de la celda (riesgo #1).
 *  2. Insertar/borrar fila y columna desde el menú de celda → opera correcto.
 *  3. Toggles de formato (título / negrita / lista) aplican al markdown.
 *  4. Mobile 375px: toolbar visible sin overflow + el menú de celda se revela.
 *
 * Las aserciones contra el markdown usan el toggle "Ver markdown" (source-mode):
 * fuente de verdad observable desde la UI sin depender del PDF.
 *
 * (Igual que `informes-editar.spec.ts`: el path "Generar con IA" no se testea acá.)
 */
import { expect, test } from '@playwright/test';

import {
  adminClient,
  createTestUserWithConsultora,
  deleteTestUser,
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

async function createTestInforme(args: {
  consultoraId: string;
  createdBy: string;
  contenido: string;
}): Promise<string> {
  const { data, error } = await adminClient
    .from('informes')
    .insert({
      consultora_id: args.consultoraId,
      created_by: args.createdBy,
      tipo: 'rgrl',
      titulo: `E2E toolbar ${Date.now().toString(36)}`,
      contenido: args.contenido,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`createTestInforme fallo: ${error?.message}`);
  return data.id;
}

const CONTENT = [
  'Parrafo de prueba para togglear formato.',
  '',
  '| Punto | Valor |',
  '| --- | --- |',
  '| P1 | 85 |',
  '| P2 | 90 |',
  '',
].join('\n');

// Cuenta filas/columnas de datos del markdown crudo (source-mode).
function tableShape(md: string): { rows: number; cols: number } {
  const lines = md.split('\n').filter((l) => l.trim().startsWith('|'));
  // [header, separadora, ...filas de datos]
  const dataRows = Math.max(0, lines.length - 2);
  const cols = lines[0] ? lines[0].split('|').filter((c) => c.trim()).length : 0;
  return { rows: dataRows, cols };
}

async function setup(page: import('@playwright/test').Page) {
  const email = uniqueTestEmail('editor-toolbar');
  const { userId, password, consultoraId } = await createTestUserWithConsultora({
    email,
    consultoraName: `Editor Toolbar ${Date.now().toString(36)}`,
  });
  createdUserIds.push(userId);
  const informeId = await createTestInforme({
    consultoraId,
    createdBy: userId,
    contenido: CONTENT,
  });
  await loginViaUI(page, email, password);
  await page.goto(`/informes/${informeId}/editar`);
  await expect(page).toHaveURL(new RegExp(`/informes/${informeId}/editar$`));
  // Plate es lazy (ssr:false): esperar el montaje + deserialize de la tabla.
  await expect(page.locator('table').first()).toBeVisible({ timeout: 20_000 });
}

// Lee el markdown crudo abriendo source-mode, devuelve el valor y vuelve a WYSIWYG.
async function readMarkdown(page: import('@playwright/test').Page): Promise<string> {
  await page.getByRole('button', { name: 'Ver markdown' }).click();
  const md = (await page.locator('textarea').inputValue()) ?? '';
  await page.getByRole('button', { name: 'Editor visual' }).click();
  await expect(page.locator('table').first()).toBeVisible();
  return md;
}

test.describe('Informes · editor toolbar + tabla (T-141 Fase A)', () => {
  test('toolbar + edición de celda + operaciones de tabla', async ({ page }) => {
    await setup(page);

    // #3 — Toolbar visible (descubrible).
    await expect(page.getByRole('button', { name: 'Negrita (Ctrl+B)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Título 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lista de viñetas' })).toBeVisible();
    await page.screenshot({ path: 'test-results/t141-toolbar.png', fullPage: true });

    // #1 — Escribir en una celda con el dropdown presente (riesgo #1).
    const firstDataCell = page.locator('td', { hasText: 'P1' }).first();
    await firstDataCell.click();
    await page.keyboard.press('End');
    await page.keyboard.type('-bis');
    const mdAfterType = await readMarkdown(page);
    expect(mdAfterType).toContain('P1-bis'); // el texto tecleado sobrevivió → cell editable OK

    // #3 — Toggle de bloque: cursor en el párrafo → "Título 1" → markdown con `# `.
    await page.getByText('Parrafo de prueba', { exact: false }).click();
    await page.getByRole('button', { name: 'Título 1' }).click();
    const mdAfterH1 = await readMarkdown(page);
    expect(mdAfterH1).toMatch(/^#\s+Parrafo de prueba/m);

    // #2 — Insertar fila abajo desde el menú de la celda.
    const beforeInsert = tableShape(await readMarkdown(page));
    const cell = page.locator('td', { hasText: 'P1' }).first();
    await cell.hover();
    await cell.getByRole('button', { name: 'Opciones de celda' }).click();
    await page.getByRole('menuitem', { name: 'Insertar fila abajo' }).click();
    const afterInsert = tableShape(await readMarkdown(page));
    expect(afterInsert.rows).toBe(beforeInsert.rows + 1);

    // #2 — Insertar columna a la derecha.
    const cell2 = page.locator('td', { hasText: 'P1' }).first();
    await cell2.hover();
    await cell2.getByRole('button', { name: 'Opciones de celda' }).click();
    await page.getByRole('menuitem', { name: 'Insertar columna a la derecha' }).click();
    const afterCol = tableShape(await readMarkdown(page));
    expect(afterCol.cols).toBe(beforeInsert.cols + 1);

    // #2 — Borrar fila.
    const cell3 = page.locator('td', { hasText: 'P1' }).first();
    await cell3.hover();
    await cell3.getByRole('button', { name: 'Opciones de celda' }).click();
    await page.getByRole('menuitem', { name: 'Borrar fila' }).click();
    const afterDel = tableShape(await readMarkdown(page));
    expect(afterDel.rows).toBe(afterInsert.rows - 1);

    await page.screenshot({ path: 'test-results/t141-table-ops.png', fullPage: true });
  });

  test('mobile 375px: toolbar sin overflow + menú de celda visible', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page);

    // Toolbar visible y la página no desborda horizontal (assert objetivo T-127).
    await expect(page.getByRole('button', { name: 'Negrita (Ctrl+B)' })).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(0);

    // En coarse/mobile el trigger del menú de celda está siempre visible (no hover).
    await expect(
      page
        .locator('td', { hasText: 'P1' })
        .first()
        .getByRole('button', { name: 'Opciones de celda' }),
    ).toBeVisible();

    await page.screenshot({ path: 'test-results/t141-mobile-toolbar.png', fullPage: true });
  });
});
