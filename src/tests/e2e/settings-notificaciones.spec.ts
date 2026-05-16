/**
 * T-035 · E2E settings/notificaciones.
 *
 * 2 escenarios:
 *  1. Happy path navegacion + persistencia:
 *     login → sidebar Configuracion → URL /settings/consultora → tab
 *     Notificaciones → URL /settings/notificaciones → toggle email OFF +
 *     radio 7d → Guardar → toast OK → reload → valores persisten.
 *  2. Cross-user smoke:
 *     user A modifica sus prefs → user B loginea → ve SUS propias (default
 *     email enabled, no muteado) sin leakage.
 */
import { expect, test } from '@playwright/test';

import {
  adminClient,
  createTestUserWithConsultora,
  deleteTestUser,
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI, logoutViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];

test.afterEach(async () => {
  // Cleanup: borrando users el cascade limpia consultora_members y
  // notification_channel_prefs (FK on delete cascade en T-031).
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Settings · Notificaciones (T-035)', () => {
  test('1. happy path: navegacion tabs + toggle + mute 7d + persistencia', async ({ page }) => {
    const email = uniqueTestEmail('notif-happy');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-035 happy ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);

    // Click "Configuración" del sidebar.
    await page.getByRole('link', { name: /Configuración/i }).click();
    await expect(page).toHaveURL(/\/settings\/consultora/);

    // Tabs visibles: Consultora + Notificaciones.
    await expect(page.getByTestId('settings-tab-consultora')).toBeVisible();
    await expect(page.getByTestId('settings-tab-notificaciones')).toBeVisible();

    // Click tab Notificaciones.
    await page.getByTestId('settings-tab-notificaciones').click();
    await expect(page).toHaveURL(/\/settings\/notificaciones/);

    // Estado inicial: email ON + sin mute.
    const toggleEmail = page.getByTestId('toggle-email');
    await expect(toggleEmail).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/Reminders a:.*@/)).toBeVisible();
    await expect(page.getByTestId('mute-status-alert')).not.toBeVisible();

    // Apagar email + seleccionar mute 7d.
    await toggleEmail.click();
    await expect(toggleEmail).toHaveAttribute('aria-checked', 'false');

    await page.getByRole('radio', { name: /7 días/i }).click();

    // Submit.
    await page.getByTestId('submit-prefs').click();
    await expect(page.getByText('Preferencias actualizadas.')).toBeVisible({ timeout: 5000 });

    // Verificar persistencia en DB (sanity rapido).
    // Post-T-033 refactor: el action SOLO crea/actualiza el row email
    // (los rows de telegram/push los gestiona cada flow de canal).
    const { data: prefs } = await adminClient
      .from('notification_channel_prefs')
      .select('channel, enabled, muted_until')
      .eq('user_id', userId);
    const emailPref = prefs?.find((p) => p.channel === 'email');
    expect(emailPref?.enabled).toBe(false);
    expect(emailPref?.muted_until).not.toBeNull();

    // Reload para verificar persistencia en UI.
    await page.reload();
    await expect(page).toHaveURL(/\/settings\/notificaciones/);

    const toggleAfterReload = page.getByTestId('toggle-email');
    await expect(toggleAfterReload).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('mute-status-alert')).toBeVisible();
    // El radio "until" queda preseleccionado porque getMuteStatus devuelve
    // paused → muteOptionToFormState() lo mapea a 'until' con la fecha real.
    const radioUntil = page.getByRole('radio', { name: /Hasta fecha específica/i });
    await expect(radioUntil).toHaveAttribute('aria-checked', 'true');
  });

  test('2. cross-user: user B ve sus propias prefs default sin leakage de A', async ({ page }) => {
    const emailA = uniqueTestEmail('notif-userA');
    const emailB = uniqueTestEmail('notif-userB');
    const { userId: userIdA, password: passA } = await createTestUserWithConsultora({
      email: emailA,
      consultoraName: `T-035 cA ${Date.now().toString(36)}`,
    });
    const { userId: userIdB, password: passB } = await createTestUserWithConsultora({
      email: emailB,
      consultoraName: `T-035 cB ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userIdA, userIdB);

    // User A modifica sus prefs.
    await loginViaUI(page, emailA, passA);
    await page.goto('/settings/notificaciones');
    await page.getByTestId('toggle-email').click();
    await page.getByRole('radio', { name: /14 días/i }).click();
    await page.getByTestId('submit-prefs').click();
    await expect(page.getByText('Preferencias actualizadas.')).toBeVisible({ timeout: 5000 });

    // Logout user A.
    await logoutViaUI(page, emailA);

    // Login user B → debe ver default (email enabled + sin mute).
    await loginViaUI(page, emailB, passB);
    await page.goto('/settings/notificaciones');

    await expect(page.getByTestId('toggle-email')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('mute-status-alert')).not.toBeVisible();
    await expect(page.getByRole('radio', { name: /^No pausar$/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
