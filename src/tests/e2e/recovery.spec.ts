import { expect, test } from '@playwright/test';

test('/recuperar-password renders form', async ({ page }) => {
  await page.goto('/recuperar-password');

  await expect(page).toHaveTitle(/Recuperar contraseña/);
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar link de recuperación' })).toBeVisible();
});

test('/recuperar-password submit vacío muestra error de validación', async ({ page }) => {
  await page.goto('/recuperar-password');

  await page.getByRole('button', { name: 'Enviar link de recuperación' }).click();
  await expect(page.getByText('Ingresá un email válido.')).toBeVisible();
});

test('/recuperar-password link "Volver a iniciar sesión" navega a /login', async ({ page }) => {
  await page.goto('/recuperar-password');
  await page.getByRole('link', { name: /Volver a iniciar sesión/ }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('/cambiar-password sin sesión → redirect a /login', async ({ page }) => {
  await page.goto('/cambiar-password');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
});

test('/dashboard?reset=ok sin sesión → redirect a /login (no muestra banner sin auth)', async ({
  page,
}) => {
  await page.goto('/dashboard?reset=ok');
  await expect(page).toHaveURL(/\/login$/);
});

// El happy path completo (recover → callback → cambiar-password → P1 falla →
// P2 entra) vive en `auth-flows.spec.ts` (T-018): crea su propio user con
// admin.createUser + bypass de email via admin.generateLink, sin opt-in flags.
