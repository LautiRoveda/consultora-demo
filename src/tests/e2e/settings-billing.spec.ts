/**
 * T-072 · E2E /settings/billing.
 *
 * 2 escenarios:
 *  1. Trial happy: login → sidebar Configuración → click tab Facturación →
 *     URL /settings/billing → Card "Plan Trial" visible + botón Suscribirme
 *     visible + empty state de facturas + badge "Trial · Nd" en sidebar.
 *  2. Member non-owner ve Alert "Solo el owner puede gestionar la
 *     suscripción" + sin botones de acción.
 *
 * NO testeamos el flow MP real (requiere credenciales sandbox + redirect
 * fuera del dominio). El click del botón se cubre en el unit test con
 * mocks. Smoke productivo del runbook valida el redirect real.
 */
import { expect, test } from '@playwright/test';

import {
  adminClient,
  createTestUserWithConsultora,
  deleteTestUser,
  TEST_PASSWORD,
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Settings · Billing (T-072)', () => {
  test('1. owner trial: tab visible + Plan Trial card + CTA Suscribirme + sidebar badge "Trial · Nd"', async ({
    page,
  }) => {
    const email = uniqueTestEmail('billing-owner');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-072 trial ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);

    // Sidebar debe mostrar el badge Trial con contador "Trial · Nd".
    const trialBadge = page.getByTestId('sidebar-trial-badge');
    await expect(trialBadge).toBeVisible();
    await expect(trialBadge).toHaveText(/Trial · \d+d/);

    // Click Configuración del sidebar.
    await page.getByRole('link', { name: /Configuración/i }).click();
    await expect(page).toHaveURL(/\/settings\/consultora/);

    // Tab Facturación visible + clickeable.
    const billingTab = page.getByTestId('settings-tab-billing');
    await expect(billingTab).toBeVisible();
    await billingTab.click();
    await expect(page).toHaveURL(/\/settings\/billing/);

    // Card "Plan Trial".
    await expect(page.getByRole('heading', { name: 'Plan Trial' })).toBeVisible();

    // CTA Suscribirme visible (owner).
    await expect(page.getByTestId('subscribe-button')).toBeVisible();

    // Empty state facturas.
    await expect(page.getByText('Todavía no hay facturas')).toBeVisible();
  });

  test('2. member non-owner: alert "Solo el owner" + sin botón Suscribirme', async ({ page }) => {
    const ownerEmail = uniqueTestEmail('billing-owner2');
    const memberEmail = uniqueTestEmail('billing-member');
    const { userId: ownerId, consultoraId } = await createTestUserWithConsultora({
      email: ownerEmail,
      consultoraName: `T-072 member ${Date.now().toString(36)}`,
    });
    createdUserIds.push(ownerId);

    // Crear member directo via service-role (no UI: signup creates own
    // consultora — para member necesitamos insert manual a consultora_members).
    const { data: memberUser, error: memberErr } = await adminClient.auth.admin.createUser({
      email: memberEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (memberErr || !memberUser.user) throw memberErr ?? new Error('member create failed');
    createdUserIds.push(memberUser.user.id);

    await adminClient.from('consultora_members').insert({
      user_id: memberUser.user.id,
      consultora_id: consultoraId,
      role: 'member',
    });
    await adminClient.auth.admin.updateUserById(memberUser.user.id, {
      app_metadata: { consultora_id: consultoraId },
    });

    await loginViaUI(page, memberEmail, TEST_PASSWORD);
    await page.goto('/settings/billing');

    await expect(page.getByText('Solo el owner puede gestionar la suscripción')).toBeVisible();
    await expect(page.getByTestId('subscribe-button')).not.toBeVisible();
  });
});
