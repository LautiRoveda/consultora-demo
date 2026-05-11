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

test('/login submit con datos válidos dispara toast "Login real llega en T-013"', async ({
  page,
}) => {
  await page.goto('/login');

  await page.getByLabel('Email').fill('lautaro@consultorademo.com.ar');
  await page.getByLabel('Contraseña').fill('password-test');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByText(/Login real llega en T-013/)).toBeVisible({ timeout: 5000 });
});

test('/login footer link "Crear cuenta" navega a /signup', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByText('Empezá tu prueba de 7 días gratis')).toBeVisible();
});

test('/login?confirmed=1 muestra banner "Cuenta confirmada"', async ({ page }) => {
  await page.goto('/login?confirmed=1');
  await expect(page.getByText('Cuenta confirmada')).toBeVisible();
  await expect(page.getByText('Ingresá con tu email y contraseña.')).toBeVisible();
});

test('/login?error=callback_failed muestra banner destructive "Link expirado"', async ({
  page,
}) => {
  await page.goto('/login?error=callback_failed');
  await expect(page.getByText('Link expirado')).toBeVisible();
  await expect(page.getByText(/El link de confirmación expiró/)).toBeVisible();
});
