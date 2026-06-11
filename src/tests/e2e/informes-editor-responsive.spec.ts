/**
 * T-140-FU1 · E2E responsive del editor de informe (mobile 375px).
 *
 * Red de regresión PERMANENTE del fix de overflow: con el editor WYSIWYG
 * full-width y una tabla GFM ancha, el viewport de 375px NO debe desbordar
 * horizontal. Assert OBJETIVO (lección T-127): `scrollWidth <= clientWidth`,
 * NUNCA "a ojo" ni con zoom-out. La tabla scrollea adentro de su wrapper
 * `overflow-x-auto` (min-w-[480px] sm:min-w-0), no rompe la página.
 *
 * Reemplaza la ruta dev throwaway `/editor-preview` (que se usó solo para el
 * demo red→green local y se borró antes del merge).
 *
 * Nota (igual que `informes-editar.spec.ts`): el path "Generar con IA" no se
 * testea acá (SDK server-side, fuera del alcance de page.route). El branch de
 * streaming-preview queda cubierto por la lógica `isStreaming → splitActive`.
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

// Helper local (misma convención que informes-editar.spec.ts): crea un informe
// via admin (service-role, bypass RLS) con contenido arbitrario.
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
      titulo: `E2E resp ${Date.now().toString(36)}`,
      contenido: args.contenido,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`createTestInforme fallo: ${error?.message}`);
  return data.id;
}

// Markdown con una tabla GFM de 5 columnas + celdas largas: el peor caso de
// ancho en 375px.
const WIDE_TABLE_CONTENT = [
  '# Informe con tabla ancha',
  '',
  'Texto introductorio del relevamiento general de riesgos laborales.',
  '',
  '| Riesgo identificado | Probabilidad | Severidad | Medida de control propuesta | Responsable |',
  '| --- | --- | --- | --- | --- |',
  '| Caída a distinto nivel en plataforma elevada | Media | Alta | Barandas perimetrales y línea de vida | Servicio HyS |',
  '| Exposición a ruido superior a 85 dB en línea 4 | Alta | Media | Protección auditiva y rotación de tareas | Jefe de planta |',
  '',
].join('\n');

test.describe('Informes · editor responsive (T-140-FU1)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('mobile 375px: editor full-width + tabla ancha scrollea sin overflow + toggles accesibles', async ({
    page,
  }) => {
    const email = uniqueTestEmail('editor-resp');
    const { userId, password, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: `Editor Resp ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    const informeId = await createTestInforme({
      consultoraId,
      createdBy: userId,
      contenido: WIDE_TABLE_CONTENT,
    });

    await loginViaUI(page, email, password);
    await page.goto(`/informes/${informeId}/editar`);
    await expect(page).toHaveURL(new RegExp(`/informes/${informeId}/editar$`));

    // Plate es lazy (`dynamic`, ssr:false): esperar a que monte y deserialice
    // la tabla del markdown antes de medir el layout.
    await expect(page.locator('table').first()).toBeVisible({ timeout: 20_000 });

    // ASSERT OBJETIVO de overflow horizontal (T-127): la página no desborda.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const el = document.documentElement;
            return el.scrollWidth - el.clientWidth;
          }),
        { timeout: 10_000 },
      )
      .toBeLessThanOrEqual(0);

    // En WYSIWYG normal ambos toggles deben estar accesibles.
    await expect(page.getByRole('button', { name: 'Ver markdown' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Vista fiel/ })).toBeVisible();

    // Screenshots a tamaño real (375px), sin zoom-out.
    await page.screenshot({ path: 'test-results/editor-mobile-full.png', fullPage: true });
    await page.locator('table').first().scrollIntoViewIfNeeded();
    await page
      .locator('table')
      .first()
      .screenshot({ path: 'test-results/editor-mobile-table.png' });

    // Activar "Vista fiel (PDF)" → aparece el preview (split, apilado en mobile)
    // y tampoco debe desbordar.
    await page.getByRole('button', { name: /Vista fiel/ }).click();
    await expect(page.getByText('Vista previa')).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const el = document.documentElement;
          return el.scrollWidth - el.clientWidth;
        }),
      )
      .toBeLessThanOrEqual(0);
    await page.screenshot({
      path: 'test-results/editor-mobile-preview-toggle.png',
      fullPage: true,
    });
  });
});
