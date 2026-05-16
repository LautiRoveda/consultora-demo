/**
 * T-033 · E2E settings/notificaciones — flow Telegram.
 *
 * **Estrategia (C) + (B) del plan**:
 *  - Test 1 (happy unlinked → linked): admin client setup directo de
 *    telegram_subscriptions linkeada (insert manual sin pasar por webhook).
 *    UI muestra "Conectado ✓" tras reload. Verifica DB persistence.
 *  - Test 2 (unlink flow): setup linked → click "Desvincular" + confirm →
 *    fila DB con unlinked_at != null + pref disabled.
 *  - Test 3 (open dialog desde unlinked): click "Vincular Telegram" → dialog
 *    muestra código de 8 chars + botón "Abrir Telegram" + spinner polling.
 *    NO completamos el /start real (eso requeriría webhook); validamos solo
 *    que el flow UI hasta `code_ready` funciona.
 *
 * NO se inyecta E2E_MODE ni se mockea fetch a api.telegram.org desde el
 * test — el webhook se cubre en integration tests. Acá validamos navigation,
 * dialog state, DB persistence post-action.
 *
 * Cleanup: borrar users via admin cascade-borra telegram_subscriptions
 * (FK on delete cascade).
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

test.describe('Settings · Notificaciones · Telegram (T-033)', () => {
  test('1. linked: admin setup directo + reload UI muestra "Conectado ✓ @username"', async ({
    page,
  }) => {
    const email = uniqueTestEmail('tg-linked');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-033 linked ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Setup admin: insertar subscription linkeada como si el user hubiera
    // completado el /start con el bot.
    await adminClient.from('telegram_subscriptions').insert({
      user_id: userId,
      telegram_chat_id: 8_888_888,
      telegram_username: 'lautaroe',
      linked_at: new Date().toISOString(),
      blocked_count: 0,
    });
    // El webhook hubiera disparado este UPSERT — simulamos para reflejar
    // estado realista en la UI.
    await adminClient
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userId, channel: 'telegram', enabled: true },
        { onConflict: 'user_id,channel' },
      );

    await loginViaUI(page, email, password);
    await page.goto('/settings/notificaciones');

    // Telegram row en estado linked.
    const row = page.getByTestId('row-telegram');
    await expect(row).toHaveAttribute('data-state', 'linked');
    await expect(page.getByTestId('telegram-badge-linked')).toBeVisible();
    await expect(page.getByTestId('telegram-badge-linked')).toContainText('@lautaroe');
    await expect(page.getByTestId('telegram-unlink-btn')).toBeVisible();
    // Sin alert blocked (blocked_count = 0).
    await expect(page.getByTestId('telegram-blocked-alert')).not.toBeVisible();
  });

  test('2. unlink flow: linked → AlertDialog confirm → DB unlinked + pref disabled', async ({
    page,
  }) => {
    const email = uniqueTestEmail('tg-unlink');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-033 unlink ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Setup linked.
    await adminClient.from('telegram_subscriptions').insert({
      user_id: userId,
      telegram_chat_id: 7_777_777,
      telegram_username: 'someone',
      linked_at: new Date().toISOString(),
      blocked_count: 0,
    });
    await adminClient
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userId, channel: 'telegram', enabled: true },
        { onConflict: 'user_id,channel' },
      );

    await loginViaUI(page, email, password);
    await page.goto('/settings/notificaciones');

    // Click Desvincular → AlertDialog.
    await page.getByTestId('telegram-unlink-btn').click();
    await expect(page.getByTestId('telegram-unlink-confirm')).toBeVisible();
    await page.getByTestId('telegram-unlink-confirm').click();

    // Toast de éxito.
    await expect(page.getByText('Telegram desvinculado.')).toBeVisible({ timeout: 5000 });

    // Row pasa a unlinked state.
    await expect(page.getByTestId('row-telegram')).toHaveAttribute('data-state', 'unlinked');

    // DB verification: unlinked_at != null + chat_id null + pref disabled.
    const { data: sub } = await adminClient
      .from('telegram_subscriptions')
      .select('unlinked_at, telegram_chat_id')
      .eq('user_id', userId)
      .single();
    expect(sub?.unlinked_at).not.toBeNull();
    expect(sub?.telegram_chat_id).toBeNull();

    const { data: pref } = await adminClient
      .from('notification_channel_prefs')
      .select('enabled')
      .eq('user_id', userId)
      .eq('channel', 'telegram')
      .single();
    expect(pref?.enabled).toBe(false);
  });

  test('3. open dialog desde unlinked: muestra código 8-char + deep-link + polling', async ({
    page,
  }) => {
    const email = uniqueTestEmail('tg-dialog');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-033 dialog ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);
    await page.goto('/settings/notificaciones');

    // Estado inicial: unlinked.
    await expect(page.getByTestId('row-telegram')).toHaveAttribute('data-state', 'unlinked');

    // Click Vincular → abre dialog.
    await page.getByTestId('telegram-link-btn').click();
    await expect(page.getByTestId('telegram-link-dialog')).toBeVisible();

    // Esperar a que el action genere el código (state = code_ready).
    await expect(page.getByTestId('dialog-code-ready')).toBeVisible({ timeout: 10_000 });
    const codeDisplay = page.getByTestId('link-code-display');
    await expect(codeDisplay).toBeVisible();
    // Código 8 chars del alfabeto sin ambiguos.
    const codeText = (await codeDisplay.textContent()) ?? '';
    expect(codeText).toMatch(/[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}/);

    // Botón "Abrir Telegram" con deep-link.
    // Button asChild renderea el <a> con data-testid en el root, así que
    // getAttribute('href') aplica directamente al testid locator.
    const openBtn = page.getByTestId('open-telegram-btn');
    await expect(openBtn).toBeVisible();
    const href = await openBtn.getAttribute('href');
    expect(href).toMatch(/^https:\/\/t\.me\/.+\?start=[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

    // Spinner de polling visible.
    await expect(page.getByTestId('polling-indicator')).toBeVisible();

    // DB: row pending con link_code activo.
    const { data: sub } = await adminClient
      .from('telegram_subscriptions')
      .select('link_code, link_code_expires_at, linked_at')
      .eq('user_id', userId)
      .single();
    expect(sub?.link_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(sub?.linked_at).toBeNull();
    expect(new Date(sub!.link_code_expires_at!).getTime()).toBeGreaterThan(Date.now());

    // Cerrar dialog sin completar — el polling debe abortarse limpio.
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByTestId('telegram-link-dialog')).not.toBeVisible();
  });
});
