/**
 * T-019 · E2E del modulo Informes.
 *
 * Cubre el happy path completo browser-side: login → crear → ver detalle →
 * volver a la lista con el informe nuevo. La cobertura de RLS/audit/actions
 * unitarias vive en integration tests.
 *
 * Setup identico a auth-flows.spec.ts: helpers admin para crear users con
 * consultora bypassing email rate limit.
 */
import { expect, test } from '@playwright/test';

import { createTestUserWithConsultora, deleteTestUser, uniqueTestEmail } from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Informes · crear + listar (T-019)', () => {
  test('login → /informes empty state → crear → detalle → volver a lista', async ({ page }) => {
    const email = uniqueTestEmail('informes-crear');
    const consultoraName = `Test Informes ${Date.now().toString(36)}`;
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);

    // Navegar a /informes desde sidebar (asegura que el nav item esta live).
    const sidebar = page.getByRole('complementary', { name: 'Barra lateral' });
    await sidebar.getByRole('link', { name: 'Informes' }).click();
    await expect(page).toHaveURL(/\/informes$/, { timeout: 10_000 });

    // Empty state visible + CTA "Crear primer informe".
    await expect(page.getByText('Todavía no tenés informes')).toBeVisible();
    await page.getByRole('link', { name: 'Crear primer informe' }).click();
    await expect(page).toHaveURL(/\/informes\/nuevo$/);

    // Form: el default del tipo es 'relevamiento'; cambiamos a Capacitación para
    // validar el Select. NOTA T-021: el path RGRL se ramifica en wizard 2-step
    // (boton "Siguiente"), cubierto por informes-rgrl-template.spec.ts. Acá
    // testeamos el "quick path" de tipos sin template parametrizado.
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Capacitación' }).click();

    const titulo = `Informe E2E ${Date.now().toString(36)}`;
    await page.getByLabel('Título').fill(titulo);
    await page.getByRole('button', { name: 'Crear informe' }).click();

    // Redirect a /informes/[id] con placeholder de contenido pendiente.
    await expect(page).toHaveURL(/\/informes\/[0-9a-f-]+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
    await expect(page.getByText('Contenido pendiente')).toBeVisible();
    await expect(page.getByText(/Capacitación · Borrador/)).toBeVisible();
  });

  test('crear via UI → row aparece en la lista', async ({ page }) => {
    const email = uniqueTestEmail('informes-lista');
    const consultoraName = `Test Informes Lista ${Date.now().toString(36)}`;
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);

    await page.goto('/informes/nuevo');
    const titulo = `Informe lista E2E ${Date.now().toString(36)}`;
    // Tipo default 'relevamiento' es valido — no tocamos el Select.
    await page.getByLabel('Título').fill(titulo);
    await page.getByRole('button', { name: 'Crear informe' }).click();

    // Redirect al detalle. Volvemos a la lista y verificamos el row.
    await expect(page).toHaveURL(/\/informes\/[0-9a-f-]+$/, { timeout: 10_000 });
    await page.getByRole('link', { name: '← Volver a Informes' }).click();
    await expect(page).toHaveURL(/\/informes$/);

    await expect(page.getByRole('link', { name: new RegExp(titulo) })).toBeVisible();
    await expect(page.getByText(/Relevamiento · Borrador/)).toBeVisible();
  });
});
