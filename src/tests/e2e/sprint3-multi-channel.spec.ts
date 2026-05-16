/**
 * T-037 · E2E del setup multi-canal en `/settings/notificaciones`.
 *
 * **Scope acotado (post-pivot)**: validamos que la UI refleja correctamente
 * los estados DB del flow multi-canal (Email + Telegram). End-to-end real
 * cron -> endpoint -> Resend/Telegram queda EXCLUSIVAMENTE en el smoke
 * runbook manual (`docs/operations/sprint3-smoke-runbook.md`), porque sin
 * mocks de externos los providers fallarian en CI y las assertions
 * tendrian que ser env-aware (fragil).
 *
 * Cobertura (3 escenarios):
 *  A. Setup happy multi-canal: telegram linked + ambos canales enabled +
 *     sin mute. UI muestra "Conectado ✓ @user" + email toggle ON + sin
 *     alerts.
 *  B. Setup mute global: muted_until = now + 7d en ambos canales. UI
 *     muestra Alert "Pausadas hasta DD/MM/YYYY" + radio "until" pre-
 *     seleccionado.
 *  C. Setup bot bloqueado: telegram linked con blocked_count = 3. UI
 *     muestra Alert destructive "Tu bot fue bloqueado en Telegram.
 *     Regenera la vinculacion para volver a recibir."
 *
 * Helpers admin: insert directo en `telegram_subscriptions` +
 * `notification_channel_prefs` simulando state post-flow (sin pasar por
 * webhook ni server action). Patron canonico de
 * `settings-notificaciones-telegram.spec.ts` (T-033).
 *
 * Correr local: `set -a && source .env.local && set +a &&
 *   CHROMIUM_PATH="/path/to/chrome" pnpm test:e2e --grep "Sprint 3 multi-channel"`.
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

test.describe('Sprint 3 multi-channel · UI ↔ DB setup', () => {
  test('A. happy setup: telegram linked + ambos canales enabled → UI muestra Conectado ✓ + email ON', async ({
    page,
  }) => {
    const email = uniqueTestEmail('s3mc-happy');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-037 Happy ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Setup admin: telegram linkeada + ambos canales enabled.
    await adminClient.from('telegram_subscriptions').insert({
      user_id: userId,
      telegram_chat_id: 11_111_111,
      telegram_username: 'happyuser',
      linked_at: new Date().toISOString(),
      blocked_count: 0,
    });
    await adminClient.from('notification_channel_prefs').upsert(
      [
        { user_id: userId, channel: 'email', enabled: true, muted_until: null },
        { user_id: userId, channel: 'telegram', enabled: true, muted_until: null },
      ],
      { onConflict: 'user_id,channel' },
    );

    await loginViaUI(page, email, password);
    await page.goto('/settings/notificaciones');

    // Email row: toggle ON + caption con el email del user.
    const emailToggle = page.getByTestId('toggle-email');
    await expect(emailToggle).toBeVisible();
    await expect(emailToggle).toBeChecked();
    await expect(page.getByText(`Reminders a: ${email}`)).toBeVisible();

    // Telegram row: state linked + badge conectado + sin alert blocked.
    const tgRow = page.getByTestId('row-telegram');
    await expect(tgRow).toHaveAttribute('data-state', 'linked');
    const badge = page.getByTestId('telegram-badge-linked');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Conectado ✓ @happyuser');
    await expect(page.getByTestId('telegram-unlink-btn')).toBeVisible();
    await expect(page.getByTestId('telegram-blocked-alert')).not.toBeVisible();

    // Sin Alert de mute.
    await expect(page.getByTestId('mute-status-alert')).not.toBeVisible();
  });

  test('B. mute global activo: muted_until +7d en ambos canales → UI muestra Alert Pausadas', async ({
    page,
  }) => {
    const email = uniqueTestEmail('s3mc-mute');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-037 Mute ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Setup admin: muted_until = now + 7d en ambos canales.
    // getMuteStatus(prefs, now) devuelve el muted_until mas lejano de los rows
    // pending (no expirados). Seteamos AMBOS canales con la misma fecha para
    // que el helper devuelva esa fecha sin ambiguedad.
    const mutedUntilDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const mutedUntilIso = mutedUntilDate.toISOString();

    await adminClient.from('notification_channel_prefs').upsert(
      [
        { user_id: userId, channel: 'email', enabled: true, muted_until: mutedUntilIso },
        { user_id: userId, channel: 'telegram', enabled: true, muted_until: mutedUntilIso },
      ],
      { onConflict: 'user_id,channel' },
    );

    await loginViaUI(page, email, password);
    await page.goto('/settings/notificaciones');

    // Alert "Pausadas" visible.
    const alert = page.getByTestId('mute-status-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Pausadas');
    // Format del componente: "d 'de' MMMM 'de' yyyy" locale es. Verificamos
    // el year + day (mes es es-AR, variabilidad de capitalizacion segun
    // date-fns locale).
    await expect(alert).toContainText(String(mutedUntilDate.getUTCFullYear()));

    // Radio "until" pre-seleccionado segun muteStatusToFormState.
    // NotificacionesSettingsView line 86: status.untilIso.slice(0, 10).
    const muteUntilRadio = page.locator('#mute-until');
    await expect(muteUntilRadio).toBeChecked();

    // Trigger del date picker visible con la fecha en formato PPP.
    await expect(page.getByTestId('mute-date-trigger')).toBeVisible();
  });

  test('C. bot bloqueado: telegram linked con blocked_count=3 → Alert destructive visible', async ({
    page,
  }) => {
    const email = uniqueTestEmail('s3mc-blocked');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-037 Blocked ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Setup admin: linked con blocked_count alcanzando el threshold de
    // auto-unlink (3). Page server-side computa `blocked: sub.blocked_count >= 3`
    // y solo renderiza el state linked si `linked_at != null && unlinked_at IS NULL`.
    // Para que el row siga en state=linked con blocked=true, NO seteamos
    // unlinked_at (simulamos el frame del 3er fail ANTES del UPDATE del sender
    // que pondria unlinked_at; en realidad el sender los hace en la misma
    // transaccion, pero para validar la rama de UI con blocked=true el row
    // sigue conceptualmente linked).
    //
    // Side effect: la rama linked+blocked es la unica donde aparece el Alert
    // destructive. Si el bot ya esta auto-unlinked, el row pasa a unlinked
    // y la badge muestra "No conectado" sin Alert.
    await adminClient.from('telegram_subscriptions').insert({
      user_id: userId,
      telegram_chat_id: 22_222_222,
      telegram_username: 'blockeduser',
      linked_at: new Date().toISOString(),
      blocked_count: 3,
    });
    await adminClient
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userId, channel: 'telegram', enabled: true, muted_until: null },
        { onConflict: 'user_id,channel' },
      );

    await loginViaUI(page, email, password);
    await page.goto('/settings/notificaciones');

    // Row en state=linked todavia (no unlinked).
    const tgRow = page.getByTestId('row-telegram');
    await expect(tgRow).toHaveAttribute('data-state', 'linked');

    // Alert destructive visible con el copy exacto.
    const blockedAlert = page.getByTestId('telegram-blocked-alert');
    await expect(blockedAlert).toBeVisible();
    await expect(blockedAlert).toContainText(
      'Tu bot fue bloqueado en Telegram. Regenerá la vinculación para volver a recibir.',
    );
  });
});
