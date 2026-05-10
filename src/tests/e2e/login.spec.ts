import { expect, test } from '@playwright/test';

test('/login carga el form', async ({ page }) => {
  await page.goto('/login');

  await expect(page).toHaveTitle(/Iniciar sesión/);
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
});

test('/login submit vacío muestra errores de validación', async ({ page }) => {
  await page.goto('/login');

  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByText('Ingresá un email válido.')).toBeVisible();
  await expect(page.getByText('Mínimo 8 caracteres.')).toBeVisible();
});

test('/login submit con datos válidos dispara toast "Auth disponible desde T-012"', async ({
  page,
}) => {
  await page.goto('/login');

  await page.getByLabel('Email').fill('lautaro@consultorademo.com.ar');
  await page.getByLabel('Contraseña').fill('password-test');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  // Sonner monta los toasts en un region con role="status" o region.
  await expect(page.getByText(/Login estará disponible desde T-012/)).toBeVisible({
    timeout: 5000,
  });
});
