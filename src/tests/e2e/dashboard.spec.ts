import { expect, test } from '@playwright/test';

test('/dashboard sin sesión → redirect a /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  // Confirmamos que estamos en /login y el form está visible.
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
});

// Los happy paths con sesión real viven en `auth-flows.spec.ts` (T-018):
// crean su propio user con admin.createUser, sin opt-in flags.
