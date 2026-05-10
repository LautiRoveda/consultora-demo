import { expect, test } from '@playwright/test';

test('home page carga y muestra contenido', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('ConsultoraDemo');
  // Boilerplate de create-next-app tiene un h1 con "To get started, edit the page.tsx file."
  // T-009 reemplazará esto. Por ahora verificamos que el documento responde.
  await expect(page.locator('body')).toBeVisible();
});

test('prototipo Fase 0 sigue siendo accesible', async ({ page }) => {
  await page.goto('/prototipo');
  // El prototipo es HTML estático con <html lang="es">.
  await expect(page).toHaveTitle(/ConsultoraDemo/);
});
