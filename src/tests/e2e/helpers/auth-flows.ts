import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * T-018 · Helpers de flow de auth via UI para tests E2E.
 *
 * Encapsulan las interacciones repetidas con `/login` y el user menu del
 * sidebar para que cada spec solo declare la intención (`loginViaUI(...)`)
 * y no duplique selectores.
 *
 * Selectores: usan `getByRole`/`getByLabel` (accesibilidad). Los aria-labels
 * del shell autenticado fueron definidos en T-017:
 *   - hamburger button: `aria-label="Abrir menú"`
 *   - user menu trigger: `aria-label={`Menú de cuenta de ${email}`}`
 */

/**
 * Realiza login UI completo: visita /login, llena form, submitea y espera
 * el redirect a `/dashboard`. Tira (via expect) si el redirect no ocurre
 * en 10s — caller no debe defenderse contra timing.
 */
export async function loginViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/dashboard(\?.*)?$/, { timeout: 10_000 });
}

/**
 * Realiza logout UI desde cualquier página dentro del shell `(app)`:
 * abre el dropdown del user menu y clickea "Cerrar sesión". Espera el
 * redirect a `/login`.
 *
 * Requiere el email para targetear el dropdown trigger (su aria-label lo
 * incluye, garantizando que apunte al menú correcto incluso si en el
 * futuro hay otros menús en la página).
 */
export async function logoutViaUI(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: `Menú de cuenta de ${email}` }).click();
  // El item es un <DropdownMenuItem onSelect> (no link ni form). Radix
  // expone role="menuitem".
  await page.getByRole('menuitem', { name: /^Cerrar sesión$/ }).click();
  await expect(page).toHaveURL(/\/login(\?.*)?$/, { timeout: 10_000 });
}
