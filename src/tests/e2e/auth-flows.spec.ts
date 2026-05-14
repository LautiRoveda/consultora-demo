/**
 * T-018 · Tests E2E del flow de auth con sesión real.
 *
 * Cubre la composición browser-side (cookies + redirect chain + render
 * client + UI state) que los integration tests no validan. Crea sus
 * propios users via admin.createUser (sin rate limit de email), por lo
 * que corre SIEMPRE en CI sin opt-in flags.
 *
 * Cleanup: `afterEach` borra los users creados en este test. Idempotente:
 * un test que falla antes de crear el user no rompe el cleanup.
 */
import { expect, test } from '@playwright/test';

import {
  createTestUserWithConsultora,
  createTestUserWithoutConsultora,
  deleteTestUser,
  generateRecoveryLinkUrl,
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI, logoutViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];

test.afterEach(async () => {
  // `splice(0)` vacía y devuelve copia — evita estado compartido entre tests.
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('layout protection (rutas autenticadas sin sesión)', () => {
  test('/dashboard sin sesión redirige a /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login(\?.*)?$/);
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
  });

  test('/cambiar-password sin sesión redirige a /login', async ({ page }) => {
    await page.goto('/cambiar-password');
    await expect(page).toHaveURL(/\/login(\?.*)?$/);
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
  });
});

test.describe('login happy path', () => {
  test('login UI → /dashboard + shell renderiza consultora + email', async ({ page }) => {
    const email = uniqueTestEmail('login-happy');
    const consultoraName = `Test Login Happy ${Date.now().toString(36)}`;
    const { userId, password, slug } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);

    // Heading del dashboard simplificado (T-017).
    await expect(page.getByText('Bienvenido a ConsultoraDemo')).toBeVisible();

    // Scope al `<aside>` del sidebar desktop. AppShell también renderiza el
    // mobile topbar (con el mismo `consultora.name`) aunque esté `md:hidden`
    // — `getByText` sin scope tira strict-mode (2 matches en el DOM).
    const sidebar = page.getByRole('complementary', { name: 'Barra lateral' });
    await expect(sidebar.getByText(consultoraName)).toBeVisible();
    await expect(sidebar.getByText(`@${slug}`)).toBeVisible();
    // User menu trigger (button del sidebar) muestra el email truncado.
    await expect(sidebar.getByText(email)).toBeVisible();
  });
});

test.describe('user sin consultora (edge case T-012/T-017)', () => {
  test('login UI con user sin membership → /login?error=no_consultora + Alert', async ({
    page,
  }) => {
    const email = uniqueTestEmail('no-consultora');
    const { userId, password } = await createTestUserWithoutConsultora(email);
    createdUserIds.push(userId);

    // No usamos `loginViaUI` porque ese helper espera redirect a /dashboard.
    // Acá la sesión es válida pero el layout `(app)` redirige a /login
    // cuando getCurrentConsultora devuelve null (T-017).
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();

    await expect(page).toHaveURL(/\/login\?error=no_consultora/, { timeout: 10_000 });
    await expect(page.getByText('Cuenta sin consultora asociada')).toBeVisible();
    await expect(page.getByText(/no tiene una consultora vinculada/)).toBeVisible();
  });
});

test.describe('logout flow', () => {
  test('login → logoutViaUI → /dashboard re-bouncea a /login (cookies borradas)', async ({
    page,
  }) => {
    const email = uniqueTestEmail('logout');
    const consultoraName = `Test Logout ${Date.now().toString(36)}`;
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);
    await logoutViaUI(page, email);

    // Cookies de auth borradas: re-acceso a /dashboard debe redirigir.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login(\?.*)?$/);
  });
});

test.describe('recovery flow completo', () => {
  test('recover → callback → cambiar-password → P1 falla, P2 entra', async ({ page }) => {
    const email = uniqueTestEmail('recovery-full');
    const consultoraName = `Test Recovery ${Date.now().toString(36)}`;
    const NEW_PASSWORD = 'NewPassword456!';
    const { userId, password: P1 } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    // (a-c) Generar URL del callback via admin.generateLink y navegar directo.
    //       T-022.5-FU4: antes este test ejercitaba el form UI de /recuperar-password
    //       (recoverPasswordAction → resetPasswordForEmail) para validar el toast
    //       "Link enviado". Eso consumía el rate limit de email del free tier de
    //       Supabase (~30/h por proyecto), y con varias ejecuciones de CI en la
    //       misma hora el test se rompía determinísticamente al saturarse el
    //       cuota. El admin API (auth.admin.generateLink) NO tiene ese rate limit
    //       y genera el mismo hashed_token consumible por el callback handler
    //       (verifyOtp type='recovery'). La cobertura UI del form de
    //       /recuperar-password vive en src/tests/e2e/recovery.spec.ts.
    //       El callback consume el token_hash y redirige a /cambiar-password
    //       con sesión recovery activa.
    const recoveryUrl = await generateRecoveryLinkUrl(email);
    await page.goto(recoveryUrl);
    await expect(page).toHaveURL(/\/cambiar-password(\?.*)?$/, { timeout: 10_000 });

    // (d) Definir nueva password → redirect a /dashboard?reset=ok + banner.
    await page.getByLabel('Nueva contraseña').fill(NEW_PASSWORD);
    await page.getByLabel('Repetí la contraseña').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page).toHaveURL(/\/dashboard\?reset=ok/, { timeout: 10_000 });
    await expect(page.getByText('Contraseña actualizada')).toBeVisible();

    // (e) Logout para forzar nuevo signin contra la DB.
    await logoutViaUI(page, email);

    // (f) Login con P1 (vieja) → INVALID_CREDENTIALS, toast error y seguimos en /login.
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Contraseña').fill(P1);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.getByText('No se pudo iniciar sesión')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login(\?.*)?$/);

    // (g) Login con P2 (nueva) → entra al dashboard.
    await loginViaUI(page, email, NEW_PASSWORD);
  });
});
