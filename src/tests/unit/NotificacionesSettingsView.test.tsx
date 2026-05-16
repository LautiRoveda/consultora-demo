/**
 * T-035 · Tests del NotificacionesSettingsView.
 *
 * Cubre los estados visuales clave + el submit handler:
 *   1. Render default (email enabled + sin mute) → toggle ON + no Alert.
 *   2. Render email disabled → toggle OFF + texto "No se enviarán mails".
 *   3. Render con muted_until futuro → Alert "Pausadas" + radio "until" preseleccionado.
 *   4. Telegram/Push rows visualmente disabled (toggle disabled + opacity-60).
 *   5. Submit con radio "7 dias" → action mockeada llamada con mute={type:'days',days:7}.
 *   6. Submit con radio "Hasta fecha" → action mockeada con mute={type:'until',date}.
 *
 * jsdom stubs heredados de EventDrawer.test (Radix usa Resize/Pointer/scrollIntoView).
 */
import type { ChannelPrefRow } from '@/app/(app)/settings/notificaciones/NotificacionesSettingsView';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificacionesSettingsView } from '@/app/(app)/settings/notificaciones/NotificacionesSettingsView';

vi.mock('server-only', () => ({}));

// jsdom no implementa ResizeObserver. Radix Select/Popover/RadioGroup lo usan.
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

type MockResult = { ok: true } | { ok: false; code: string; message: string };
const mockAction = vi.fn<(input: unknown) => Promise<MockResult>>().mockResolvedValue({
  ok: true,
});

vi.mock('@/app/(app)/settings/notificaciones/actions', () => ({
  updateNotificationPrefsAction: (input: unknown) => mockAction(input),
}));

// T-033 — mock de telegram-actions (importa env.ts que valida secretos
// y rompe el test unit sin .env.local cargado).
vi.mock('@/app/(app)/settings/notificaciones/telegram-actions', () => ({
  generateTelegramLinkCodeAction: vi.fn().mockResolvedValue({
    ok: true,
    code: 'ABCD2345',
    deepLink: 'https://t.me/testbot?start=ABCD2345',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  }),
  unlinkTelegramAction: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  mockAction.mockClear();
});

function makePrefs(overrides: { emailEnabled?: boolean; emailMutedUntil?: string | null }): {
  email: ChannelPrefRow;
  telegram: ChannelPrefRow;
  push: ChannelPrefRow;
} {
  return {
    email: {
      channel: 'email',
      enabled: overrides.emailEnabled ?? true,
      muted_until: overrides.emailMutedUntil ?? null,
    },
    telegram: { channel: 'telegram', enabled: false, muted_until: null },
    push: { channel: 'push', enabled: false, muted_until: null },
  };
}

describe('NotificacionesSettingsView — render', () => {
  it('1. render con email enabled + sin mute → toggle ON + sin Alert "Pausadas"', () => {
    render(
      <NotificacionesSettingsView
        userEmail="test@example.com"
        initialPrefs={makePrefs({ emailEnabled: true, emailMutedUntil: null })}
        telegramInitialState={{ kind: 'unlinked' }}
      />,
    );

    const toggle = screen.getByTestId('toggle-email');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    expect(screen.getByText(/Reminders a:.*test@example\.com/)).toBeInTheDocument();
    expect(screen.queryByTestId('mute-status-alert')).not.toBeInTheDocument();
  });

  it('2. email disabled → toggle OFF + texto "No se enviarán mails"', () => {
    render(
      <NotificacionesSettingsView
        userEmail="test@example.com"
        initialPrefs={makePrefs({ emailEnabled: false })}
        telegramInitialState={{ kind: 'unlinked' }}
      />,
    );

    const toggle = screen.getByTestId('toggle-email');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/No se enviarán mails/)).toBeInTheDocument();
  });

  it('3. muted_until futuro → Alert "Pausadas" + radio until preseleccionado', () => {
    // Construir muted_until ~30d en el futuro relativo a now.
    const futureIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    render(
      <NotificacionesSettingsView
        userEmail="test@example.com"
        initialPrefs={makePrefs({ emailEnabled: true, emailMutedUntil: futureIso })}
        telegramInitialState={{ kind: 'unlinked' }}
      />,
    );

    expect(screen.getByTestId('mute-status-alert')).toBeInTheDocument();

    const radioUntil = screen.getByRole('radio', { name: /Hasta fecha específica/i });
    expect(radioUntil).toHaveAttribute('aria-checked', 'true');

    // El date trigger button debe estar visible con la fecha preformateada.
    const trigger = screen.getByTestId('mute-date-trigger');
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).not.toBe('Elegir fecha');
  });

  it('4. Push row visualmente disabled. Telegram row activo (unlinked + "Vincular Telegram")', () => {
    render(
      <NotificacionesSettingsView
        userEmail="test@example.com"
        initialPrefs={makePrefs({})}
        telegramInitialState={{ kind: 'unlinked' }}
      />,
    );

    // Push sigue disabled (T-034 no implementado).
    const rowPush = screen.getByTestId('row-push');
    expect(rowPush.className).toContain('opacity-60');
    expect(screen.getByTestId('toggle-push')).toBeDisabled();

    // Telegram (T-033) ahora activo: data-state="unlinked" + badge + botón Vincular.
    const rowTelegram = screen.getByTestId('row-telegram');
    expect(rowTelegram).toHaveAttribute('data-state', 'unlinked');
    expect(screen.getByTestId('telegram-badge-unlinked')).toBeInTheDocument();
    expect(screen.getByTestId('telegram-link-btn')).toBeInTheDocument();
  });
});

describe('NotificacionesSettingsView — submit', () => {
  it('5. submit con radio "7 dias" → action llamada con mute={type:days,days:7}', async () => {
    const user = userEvent.setup();
    render(
      <NotificacionesSettingsView
        userEmail="test@example.com"
        initialPrefs={makePrefs({})}
        telegramInitialState={{ kind: 'unlinked' }}
      />,
    );

    await user.click(screen.getByRole('radio', { name: /7 días/i }));
    await user.click(screen.getByTestId('submit-prefs'));

    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(mockAction).toHaveBeenCalledWith({
      emailEnabled: true,
      mute: { type: 'days', days: 7 },
    });
  });

  it('6. submit con radio "Hasta fecha" + fecha hidratada → action con mute={type:until,date}', async () => {
    // El form pre-rellena `muteDate` al click del radio "until" con
    // `dateToCivilIso(new Date())`. fireEvent es suficiente — no necesitamos
    // abrir el date picker para este test, solo verificar el wiring del submit.
    const user = userEvent.setup();
    render(
      <NotificacionesSettingsView
        userEmail="test@example.com"
        initialPrefs={makePrefs({})}
        telegramInitialState={{ kind: 'unlinked' }}
      />,
    );

    await user.click(screen.getByRole('radio', { name: /Hasta fecha específica/i }));
    // Una vez seleccionado, el trigger del date picker debe existir + el
    // muteDate default debe ser today (formateado por dateToCivilIso).
    expect(screen.getByTestId('mute-date-trigger')).toBeInTheDocument();

    await user.click(screen.getByTestId('submit-prefs'));

    expect(mockAction).toHaveBeenCalledTimes(1);
    const firstCall = mockAction.mock.calls[0];
    expect(firstCall).toBeDefined();
    const call = firstCall![0] as {
      emailEnabled: boolean;
      mute: { type: string; date?: string };
    };
    expect(call.emailEnabled).toBe(true);
    expect(call.mute.type).toBe('until');
    expect(call.mute.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('7. submit con email toggle off + mute=none → action con emailEnabled=false', async () => {
    const user = userEvent.setup();
    render(
      <NotificacionesSettingsView
        userEmail="test@example.com"
        initialPrefs={makePrefs({ emailEnabled: true })}
        telegramInitialState={{ kind: 'unlinked' }}
      />,
    );

    // El Switch shadcn responde a click pero no a fireEvent.change con un checkbox.
    fireEvent.click(screen.getByTestId('toggle-email'));
    await user.click(screen.getByTestId('submit-prefs'));

    expect(mockAction).toHaveBeenCalledWith({
      emailEnabled: false,
      mute: { type: 'none' },
    });
  });
});
