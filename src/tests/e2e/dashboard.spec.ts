import { expect, test } from '@playwright/test';

test('/dashboard sin sesión → redirect a /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  // Confirmamos que estamos en /login y el form está visible.
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
});

// Happy path con sesión real: igual que /signup E2E, requiere Supabase real +
// un user de prueba con consultora. Skip por default (no romper CI ni iteración
// local sin setup). Opt-in con E2E_SUPABASE_SIGNIN=1 + variables E2E_TEST_EMAIL
// / E2E_TEST_PASSWORD.
const runE2ESignin = process.env.E2E_SUPABASE_SIGNIN === '1';
const testEmail = process.env.E2E_TEST_EMAIL;
const testPassword = process.env.E2E_TEST_PASSWORD;

test.describe('/dashboard happy path (requires real Supabase + opt-in)', () => {
  test.skip(
    !runE2ESignin || !testEmail || !testPassword,
    'Opt-in via E2E_SUPABASE_SIGNIN=1 + E2E_TEST_EMAIL + E2E_TEST_PASSWORD',
  );

  test('login → dashboard muestra email + slug', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(testEmail!);
    await page.getByLabel('Contraseña').fill(testPassword!);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10000 });
    await expect(page.getByText(`Hola, ${testEmail!}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  });

  test('logout → vuelve a /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(testEmail!);
    await page.getByLabel('Contraseña').fill(testPassword!);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10000 });

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 10000 });

    // Re-load /dashboard → debe re-redirigir a /login.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});
