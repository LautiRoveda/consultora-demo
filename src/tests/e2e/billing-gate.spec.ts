/**
 * T-073 · E2E del trial gate enforcement.
 *
 * 3 escenarios:
 *  1. Trial vencido → banner sticky visible al tope del AppShell + texto
 *     "Tu trial venció…" + link "Suscribirme →".
 *  2. Trial vencido + intento de crear cliente → toast "Plan expirado"
 *     (la action retorna BILLING_GATED).
 *  3. Trial vigente → banner NO visible.
 *
 * Requisito: el server next debe correr con `BILLING_GATE_DISABLED=false`.
 *   - En CI ✓ (ci.yml lo setea explícito).
 *   - Localmente, `.env.local` de Lautaro tiene `BILLING_GATE_DISABLED=true`
 *     para dev — este test va a fallar local porque el banner no aparece.
 *     Para correr local: `BILLING_GATE_DISABLED=false pnpm test:e2e`
 *     (parar antes el `pnpm dev` ya corriendo, o el webServer reusa el
 *     server existente con su env).
 */
import { expect, test } from '@playwright/test';

import {
  adminClient,
  createTestUserWithConsultora,
  deleteTestUser,
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Trial gate (T-073)', () => {
  test('1. trial vencido → banner sticky visible con CTA "Suscribirme"', async ({ page }) => {
    const email = uniqueTestEmail('billing-gated');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-073 gated ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Forzar trial vencido: trial_hasta = ayer.
    const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString();
    await adminClient
      .from('consultoras')
      .update({ trial_hasta: yesterdayIso })
      .eq('id', consultoraId);

    await loginViaUI(page, email, password);

    // Banner visible con texto del TRIAL_EXPIRED.
    const banner = page.getByRole('alert').filter({ hasText: /Tu trial venció/i });
    await expect(banner).toBeVisible();
    // Link CTA dentro del banner.
    await expect(banner.getByRole('link', { name: /Suscribirme/i })).toBeVisible();
  });

  test('2. trial vencido → submit de /clientes/nuevo → toast "Plan expirado"', async ({ page }) => {
    const email = uniqueTestEmail('billing-gated-create');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-073 gated create ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString();
    await adminClient
      .from('consultoras')
      .update({ trial_hasta: yesterdayIso })
      .eq('id', consultoraId);

    await loginViaUI(page, email, password);
    await page.goto('/clientes/nuevo');

    // Llenar mínimo y submitear. La validación Zod pasa, la action devuelve
    // BILLING_GATED post-auth.
    await page.getByLabel(/Razón social/i).fill('Test gated SA');
    await page.getByLabel(/CUIT/i).fill('30-12345678-9');
    await page.getByRole('button', { name: /Crear cliente/i }).click();

    // Toast con título "Plan expirado".
    await expect(page.getByText(/Plan expirado/i)).toBeVisible({ timeout: 5_000 });
  });

  test('3. trial vigente → banner NO visible', async ({ page }) => {
    const email = uniqueTestEmail('billing-ok');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-073 ok ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Default del signup: trial_hasta = now + 7d (no necesita override).
    await loginViaUI(page, email, password);

    // El banner NO debe estar en el DOM (BillingGateBanner retorna null
    // cuando ok=true).
    const banner = page.getByRole('alert').filter({ hasText: /trial venció/i });
    await expect(banner).toHaveCount(0);
  });
});
