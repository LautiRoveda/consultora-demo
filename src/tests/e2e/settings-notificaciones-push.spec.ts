/**
 * T-034 · E2E settings/notificaciones — flow Push web.
 *
 * **Estrategia bypass browser (decisión cerrada del plan)**:
 * Playwright NO permite mockear Notification.permission ni pushManager.subscribe
 * con fidelidad (requiere browser flags + son user-gesture-gated). Mocks parciales
 * producen tests frágiles. En su lugar usamos `page.addInitScript` para inyectar
 * stubs de `navigator.serviceWorker` y `Notification` ANTES de cualquier JS de
 * la app, simulando los estados que la state machine de PushChannelRow detecta.
 *
 * Cobertura E2E real (no mockable):
 *  - cron → endpoint dispatch-reminder → web-push → SW recibe push → notification visible
 *    queda EXCLUSIVAMENTE en smoke productivo manual del runbook (igual T-033 Telegram).
 *
 * Tests:
 *  1. unsupported: removed navigator.serviceWorker → UI Alert "Navegador incompatible".
 *  2. permission_denied: Notification.permission='denied' → UI badge "Bloqueado" + Alert.
 *  3. subscribed: admin INSERT push_sub + mock navigator.serviceWorker.getRegistration
 *     returns fake sub → UI badge "Activadas en este dispositivo" + botón Desactivar.
 *
 * Cleanup: borrar users via admin cascade-borra push_subscriptions.
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

// FLAKY (Windows local paralelo): ver issue #56 — patrón cross-worker race
// con `next dev` HMR + admin client setup compitiendo por sesión. CI Ubuntu
// corre con workers=1 + retries=2 (ver playwright.config.ts isCI) y los 3
// tests pasan estables. Localmente verificar con `pnpm test:e2e --workers=1`.
// NO investigar Chromium-Windows-specific sin demanda real (lección T-037).
test.describe('Settings · Notificaciones · Push (T-034)', () => {
  test('1. unsupported: sin navigator.serviceWorker → Alert "Navegador incompatible"', async ({
    page,
  }) => {
    const email = uniqueTestEmail('push-unsup');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-034 unsup ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Inject ANTES de cualquier JS de la app: deletar serviceWorker support.
    // Chromium real soporta SW; el delete fuerza el branch 'unsupported'.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get: () => undefined,
      });
      delete (window as { PushManager?: object }).PushManager;
    });

    await loginViaUI(page, email, password);
    await page.goto('/settings/notificaciones');

    // Esperar el render post-mount del PushChannelRow.
    const rowPush = page.getByTestId('row-push');
    await expect(rowPush).toHaveAttribute('data-state', 'unsupported', { timeout: 5000 });
    await expect(page.getByTestId('push-badge-unsupported')).toBeVisible();
    await expect(page.getByTestId('push-unsupported-alert')).toBeVisible();
    await expect(page.getByTestId('push-activate-btn')).not.toBeVisible();
  });

  test('2. permission_denied: Notification.permission=denied → Alert destructive', async ({
    page,
  }) => {
    const email = uniqueTestEmail('push-denied');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-034 denied ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Override Notification.permission a 'denied' antes del mount.
    await page.addInitScript(() => {
      // @ts-expect-error - reassign browser global
      window.Notification = Object.assign(function Notification() {}, {
        permission: 'denied',
        requestPermission: () => Promise.resolve('denied'),
      });
    });

    await loginViaUI(page, email, password);
    await page.goto('/settings/notificaciones');

    const rowPush = page.getByTestId('row-push');
    await expect(rowPush).toHaveAttribute('data-state', 'permission_denied', { timeout: 5000 });
    await expect(page.getByTestId('push-badge-denied')).toBeVisible();
    await expect(page.getByTestId('push-denied-alert')).toBeVisible();
    await expect(page.getByTestId('push-activate-btn')).not.toBeVisible();
  });

  test('3. subscribed: admin INSERT push_sub + mock getRegistration → "Activadas"', async ({
    page,
  }) => {
    const email = uniqueTestEmail('push-sub');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-034 sub ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    const fakeEndpoint = `https://fcm.googleapis.com/fcm/send/t034-e2e-${Date.now().toString(36)}`;

    // Setup admin: INSERT push_subscription como si el user hubiera completado
    // el subscribe flow en otro device. Pref enabled (simulamos el auto-enable).
    await adminClient.from('push_subscriptions').insert({
      user_id: userId,
      endpoint: fakeEndpoint,
      p256dh_key: 'fake-p256dh-base64url',
      auth_key: 'fake-auth-base64url',
      user_agent: 'Playwright E2E Test',
    });
    await adminClient
      .from('notification_channel_prefs')
      .upsert(
        { user_id: userId, channel: 'push', enabled: true },
        { onConflict: 'user_id,channel' },
      );

    // Mock navigator.serviceWorker.getRegistration → devuelve un fake reg
    // con pushManager.getSubscription que retorna sub con endpoint matcheable.
    // También force Notification.permission='granted' (Chromium real puede
    // defaulteo a 'denied' para sitios http sin user gesture).
    await page.addInitScript((ep: string) => {
      const fakeSub = {
        endpoint: ep,
        toJSON: () => ({ endpoint: ep, keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' } }),
        unsubscribe: () => Promise.resolve(true),
      };
      const fakeReg = {
        pushManager: {
          getSubscription: () => Promise.resolve(fakeSub),
          subscribe: () => Promise.resolve(fakeSub),
        },
      };
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          getRegistration: () => Promise.resolve(fakeReg),
          register: () => Promise.resolve(fakeReg),
          ready: Promise.resolve(fakeReg),
        },
      });
      // PushManager presence check para el feature detect.
      // @ts-expect-error - browser global injection
      window.PushManager = function () {};
      // Override Notification.permission a 'granted' para que el branch
      // 'permission_denied' del mount no se dispare.
      // @ts-expect-error - reassign browser global
      window.Notification = Object.assign(function Notification() {}, {
        permission: 'granted',
        requestPermission: () => Promise.resolve('granted'),
      });
    }, fakeEndpoint);

    await loginViaUI(page, email, password);
    await page.goto('/settings/notificaciones');

    const rowPush = page.getByTestId('row-push');
    await expect(rowPush).toHaveAttribute('data-state', 'subscribed', { timeout: 5000 });
    await expect(page.getByTestId('push-badge-subscribed')).toBeVisible();
    await expect(page.getByTestId('push-deactivate-btn')).toBeVisible();

    // DB verification: la sub existe.
    const { data: subs } = await adminClient
      .from('push_subscriptions')
      .select('endpoint, p256dh_key, user_agent')
      .eq('user_id', userId);
    expect(subs).toHaveLength(1);
    expect(subs![0]!.endpoint).toBe(fakeEndpoint);
    expect(subs![0]!.user_agent).toBe('Playwright E2E Test');
  });
});
