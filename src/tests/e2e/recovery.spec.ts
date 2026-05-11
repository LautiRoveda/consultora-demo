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

// Happy path completo requiere flujo email real + sesión recovery.
// Lo cubre el smoke manual de PARADA #2 + integration test con admin.generateLink.
const runE2ERecovery = process.env.E2E_SUPABASE_RECOVERY === '1';

test.describe('recovery happy path (requires real Supabase + opt-in)', () => {
  test.skip(!runE2ERecovery, 'Opt-in via E2E_SUPABASE_RECOVERY=1');

  test('submit recover form con email válido dispara toast', async ({ page }) => {
    await page.goto('/recuperar-password');
    await page.getByLabel('Email').fill(`recovery-e2e-${Date.now()}@example.com`);
    await page.getByRole('button', { name: 'Enviar link de recuperación' }).click();
    await expect(page.getByText(/Si el email/)).toBeVisible({ timeout: 10000 });
  });
});
