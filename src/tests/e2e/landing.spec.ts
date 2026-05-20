import { expect, test } from '@playwright/test';

test('landing carga con hero, CTAs y FAQ', async ({ page }) => {
  await page.goto('/');

  // Title con el formato del template ("default · ConsultoraDemo").
  await expect(page).toHaveTitle(/ConsultoraDemo/);

  // H1 único, balance del hero.
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toContainText('piloto automático');

  // CTA primario.
  await expect(page.getByRole('link', { name: 'Empezar prueba de 7 días' }).first()).toBeVisible();

  // FAQ render con `<details>`.
  await expect(page.getByText('¿Necesito tarjeta de crédito para probar?')).toBeVisible();
});

test('skip-link al main content existe y es navegable por teclado', async ({ page }) => {
  await page.goto('/');
  // El skip-link es el primer link focusable de la página.
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toContainText('Saltar al contenido');
});
