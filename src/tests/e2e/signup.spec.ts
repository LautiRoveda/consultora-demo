import { expect, test } from '@playwright/test';

test('/signup carga el form', async ({ page }) => {
  await page.goto('/signup');

  await expect(page).toHaveTitle(/Crear cuenta/);
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toBeVisible();
  await expect(page.getByLabel('Nombre de la consultora')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear cuenta' })).toBeVisible();
});

test('/signup submit vacío muestra 3 errores de validación', async ({ page }) => {
  await page.goto('/signup');

  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(page.getByText('Ingresá un email válido.')).toBeVisible();
  await expect(page.getByText('Mínimo 8 caracteres.')).toBeVisible();
  await expect(page.getByText('Mínimo 2 caracteres.')).toBeVisible();
});

test('/signup link footer "Iniciar sesión" navega a /login', async ({ page }) => {
  await page.goto('/signup');
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

// El happy path completo (form → signUp real → redirect a /check-email) NO se
// testea automatizado por dos razones:
// 1. CI usa Supabase placeholder — `auth.signUp` falla con DNS error.
// 2. Supabase rate-limita signUps a ~30/h por IP. Correr este test en cada
//    iteración local consume la cuota y bloquea iteración.
//
// Se cubre con:
// - PARADA #2 smoke manual (Lautaro con email real desde localhost:3000).
// - Smoke post-merge contra production.
// - Integration test del RPC (sin signUp) en `signup.test.ts`.
//
// Para correr el happy path E2E ad-hoc, setear E2E_SUPABASE_SIGNUP=1 y tener
// Supabase real en NEXT_PUBLIC_SUPABASE_URL.
const runE2ESignup = process.env.E2E_SUPABASE_SIGNUP === '1';

test.describe('/signup happy path (requires real Supabase + opt-in)', () => {
  test.skip(!runE2ESignup, 'Opt-in via E2E_SUPABASE_SIGNUP=1 para evitar rate limit');

  test('/signup submit válido → redirect a /check-email?email=...', async ({ page }) => {
    const email = `t012-e2e-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Contraseña').fill('TestPassword123!');
    await page.getByLabel('Nombre de la consultora').fill('Test Consultora E2E');
    await page.getByRole('button', { name: 'Crear cuenta' }).click();

    await expect(page).toHaveURL(/\/check-email/, { timeout: 10000 });
    await expect(page.getByText(email)).toBeVisible();
  });
});

test('/check-email muestra el email del query param', async ({ page }) => {
  await page.goto('/check-email?email=test%40example.com');
  await expect(page.getByText('Revisá tu email')).toBeVisible();
  await expect(page.getByText('test@example.com')).toBeVisible();
});
