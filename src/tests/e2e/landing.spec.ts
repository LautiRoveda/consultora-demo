import { expect, test } from '@playwright/test';

test('landing carga con hero, CTAs y FAQ', async ({ page }) => {
  // T-149 DEMO red→green (a) — fallo INTENCIONAL, se revierte. NO mergear.
  expect(1, 'T-149 demo (a): un shard de E2E en rojo debe pintar ci-passed rojo').toBe(2);
  await page.goto('/');

  // Title con el formato del template ("default · ConsultoraDemo").
  await expect(page).toHaveTitle(/ConsultoraDemo/);

  // H1 único, balance del hero.
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toContainText('IA argentina');

  // CTA primario.
  await expect(page.getByRole('link', { name: 'Empezar 14 días gratis' }).first()).toBeVisible();

  // FAQ producto post-CP4 rewrite (load-bearing legal — disclaimer profesional).
  await expect(page.getByText('¿ConsultoraDemo reemplaza mi firma profesional?')).toBeVisible();
});

test('skip-link al main content existe y es navegable por teclado', async ({ page }) => {
  await page.goto('/');
  // El skip-link es el primer link focusable de la página.
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toContainText('Saltar al contenido');
});
