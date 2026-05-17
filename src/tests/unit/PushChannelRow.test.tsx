/**
 * T-034 · Tests component del PushChannelRow.
 *
 * Cubre los 5 estados de la state machine + flows subscribe/unsubscribe:
 *  1. mount unsupported → badge + Alert "Navegador incompatible".
 *  2. mount permission_denied → badge "Bloqueado" + Alert destructive.
 *  3. mount not_subscribed → badge "No activadas" + botón "Activar".
 *  4. mount subscribed → badge "Activadas en este dispositivo" + botón Desactivar.
 *  5. activate flow: permission denied → state cambia a 'permission_denied'.
 *  6. activate flow happy: subscribe OK → fetch POST + state cambia a subscribed.
 *  7. deactivate flow: fetch DELETE + state vuelve a not_subscribed.
 *
 * Mocks:
 *  - navigator.serviceWorker (register/getRegistration).
 *  - window.PushManager (presencia).
 *  - Notification API (permission + requestPermission).
 *  - global fetch.
 *  - sonner toast.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PushChannelRow } from '@/app/(app)/settings/notificaciones/PushChannelRow';

vi.mock('server-only', () => ({}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// jsdom no implementa ResizeObserver — Radix lo usa para Tooltip/Dialog.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

const VAPID_KEY = 'dummy-vapid-public-key-base64url-for-tests';

type SwReg = {
  pushManager: {
    getSubscription: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
};

function installPushSupport(opts: {
  permission?: NotificationPermission;
  getSubscription?: unknown;
  subscribeResult?: unknown;
}): { mockReg: SwReg } {
  const mockSub = opts.getSubscription ?? null;
  const mockReg: SwReg = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(mockSub),
      subscribe: vi.fn().mockResolvedValue(opts.subscribeResult ?? null),
    },
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(mockReg),
      register: vi.fn().mockResolvedValue(mockReg),
      ready: Promise.resolve(mockReg),
    },
  });

  // PushManager presence check.
  (globalThis as unknown as { PushManager: object }).PushManager = function () {};

  // Notification API
  (globalThis as unknown as { Notification: unknown }).Notification = Object.assign(
    function Notification() {},
    {
      permission: opts.permission ?? 'default',
      requestPermission: vi.fn().mockResolvedValue(opts.permission ?? 'granted'),
    },
  );

  return { mockReg };
}

function uninstallPushSupport(): void {
  // @ts-expect-error - cleanup test global
  delete navigator.serviceWorker;
  // @ts-expect-error - cleanup test global
  delete globalThis.PushManager;
  // @ts-expect-error - cleanup test global
  delete globalThis.Notification;
}

// Mock parcial de PushSubscription — solo los métodos que PushChannelRow
// consume. Tipo intencionalmente laxo (el browser real provee shape completo).
function makeFakeSubscription(endpoint: string): unknown {
  return {
    endpoint,
    expirationTime: null,
    options: { applicationServerKey: null, userVisibleOnly: true },
    getKey: () => null,
    toJSON: () => ({
      endpoint,
      keys: { p256dh: 'fake-p256dh-key', auth: 'fake-auth-key' },
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

afterEach(() => {
  cleanup();
  uninstallPushSupport();
  vi.restoreAllMocks();
});

describe('PushChannelRow — mount states', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  });

  it('1. unsupported: sin navigator.serviceWorker → badge + Alert incompatible', async () => {
    // No instalamos push support. Navigator.serviceWorker undefined.
    render(<PushChannelRow vapidPublicKey={VAPID_KEY} />);

    await waitFor(() => {
      expect(screen.getByTestId('push-badge-unsupported')).toBeInTheDocument();
    });
    expect(screen.getByTestId('push-unsupported-alert')).toBeInTheDocument();
    expect(screen.queryByTestId('push-activate-btn')).not.toBeInTheDocument();
  });

  it('2. permission_denied: Notification.permission=denied → badge + Alert destructive', async () => {
    installPushSupport({ permission: 'denied' });
    render(<PushChannelRow vapidPublicKey={VAPID_KEY} />);

    await waitFor(() => {
      expect(screen.getByTestId('push-badge-denied')).toBeInTheDocument();
    });
    expect(screen.getByTestId('push-denied-alert')).toBeInTheDocument();
    expect(screen.queryByTestId('push-activate-btn')).not.toBeInTheDocument();
  });

  it('3. not_subscribed: permission default + sin sub → badge + botón Activar', async () => {
    installPushSupport({ permission: 'default', getSubscription: null });
    render(<PushChannelRow vapidPublicKey={VAPID_KEY} />);

    await waitFor(() => {
      expect(screen.getByTestId('push-badge-unsubscribed')).toBeInTheDocument();
    });
    expect(screen.getByTestId('push-activate-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('push-deactivate-btn')).not.toBeInTheDocument();
  });

  it('4. subscribed: getSubscription retorna sub → badge "Activadas" + botón Desactivar', async () => {
    const sub = makeFakeSubscription('https://fcm.googleapis.com/fcm/send/test-S4');
    installPushSupport({ permission: 'granted', getSubscription: sub });
    render(<PushChannelRow vapidPublicKey={VAPID_KEY} />);

    await waitFor(() => {
      expect(screen.getByTestId('push-badge-subscribed')).toBeInTheDocument();
    });
    expect(screen.getByTestId('push-deactivate-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('push-activate-btn')).not.toBeInTheDocument();
  });
});

describe('PushChannelRow — activate flow', () => {
  it('5. activate: requestPermission denied → state cambia a permission_denied', async () => {
    const user = userEvent.setup();
    installPushSupport({ permission: 'default', getSubscription: null });
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    // Override requestPermission to return denied.
    (
      globalThis as unknown as { Notification: { requestPermission: ReturnType<typeof vi.fn> } }
    ).Notification.requestPermission = vi.fn().mockResolvedValue('denied');

    render(<PushChannelRow vapidPublicKey={VAPID_KEY} />);
    await waitFor(() => {
      expect(screen.getByTestId('push-activate-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('push-activate-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('push-badge-denied')).toBeInTheDocument();
    });
  });

  it('6. activate happy: subscribe OK + fetch POST → state cambia a subscribed', async () => {
    const user = userEvent.setup();
    const sub = makeFakeSubscription('https://fcm.googleapis.com/fcm/send/test-S6');
    installPushSupport({
      permission: 'default',
      getSubscription: null, // mount inicial sin sub
      subscribeResult: sub, // activate triggera subscribe → retorna sub
    });
    (
      globalThis as unknown as { Notification: { requestPermission: ReturnType<typeof vi.fn> } }
    ).Notification.requestPermission = vi.fn().mockResolvedValue('granted');

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, subscriptionId: 'sub-uuid' }), { status: 201 }),
      );

    render(<PushChannelRow vapidPublicKey={VAPID_KEY} />);
    await waitFor(() => {
      expect(screen.getByTestId('push-activate-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('push-activate-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('push-badge-subscribed')).toBeInTheDocument();
    });

    // POST /api/push/subscribe llamado con shape correcto.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/push/subscribe',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"endpoint":"https://fcm.googleapis.com/fcm/send/test-S6"'),
      }),
    );
  });
});

describe('PushChannelRow — deactivate flow', () => {
  it('7. deactivate: fetch DELETE OK + sub.unsubscribe local + state → not_subscribed', async () => {
    const user = userEvent.setup();
    const sub = makeFakeSubscription('https://fcm.googleapis.com/fcm/send/test-S7');
    installPushSupport({ permission: 'granted', getSubscription: sub });

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, deletedCount: 1 }), { status: 200 }),
      );

    render(<PushChannelRow vapidPublicKey={VAPID_KEY} />);
    await waitFor(() => {
      expect(screen.getByTestId('push-deactivate-btn')).toBeInTheDocument();
    });

    // Open AlertDialog + confirm.
    await user.click(screen.getByTestId('push-deactivate-btn'));
    await user.click(await screen.findByTestId('push-deactivate-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('push-badge-unsubscribed')).toBeInTheDocument();
    });

    // DELETE /api/push/unsubscribe llamado con endpoint correcto.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/push/unsubscribe',
      expect.objectContaining({
        method: 'DELETE',
        body: expect.stringContaining('test-S7'),
      }),
    );

    // Local unsubscribe llamado.
    const subWithUnsubscribe = sub as { unsubscribe: ReturnType<typeof vi.fn> };
    expect(subWithUnsubscribe.unsubscribe.mock.calls.length).toBe(1);
  });
});
