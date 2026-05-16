/**
 * T-033 · Tests component del TelegramChannelRow.
 *
 * Cobertura:
 *  1. Estado 'unlinked' → Badge "No conectado" + botón "Vincular Telegram".
 *  2. Estado 'pending' → Badge "Esperando vinculación" + botón "Continuar".
 *  3. Estado 'linked' con username → Badge "Conectado ✓ @username" + botón "Desvincular".
 *  4. Estado 'linked' con blocked=true → Alert destructive visible.
 *
 * jsdom stubs heredados de NotificacionesSettingsView.test.tsx para Radix.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TelegramChannelRow } from '@/app/(app)/settings/notificaciones/TelegramChannelRow';

vi.mock('server-only', () => ({}));

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

// Mock action — el componente lo importa pero los tests de este archivo no
// invocan handlers que disparen la action. Mock previene el load del env.ts.
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
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
});

describe('TelegramChannelRow', () => {
  it('1. unlinked → Badge "No conectado" + botón "Vincular Telegram"', () => {
    render(<TelegramChannelRow initialState={{ kind: 'unlinked' }} />);

    const row = screen.getByTestId('row-telegram');
    expect(row).toHaveAttribute('data-state', 'unlinked');
    expect(screen.getByTestId('telegram-badge-unlinked')).toBeInTheDocument();
    expect(screen.getByTestId('telegram-link-btn')).toHaveTextContent(/Vincular Telegram/);
    expect(screen.queryByTestId('telegram-unlink-btn')).not.toBeInTheDocument();
  });

  it('2. pending → Badge "Esperando vinculación" + botón "Continuar"', () => {
    render(<TelegramChannelRow initialState={{ kind: 'pending' }} />);

    const row = screen.getByTestId('row-telegram');
    expect(row).toHaveAttribute('data-state', 'pending');
    expect(screen.getByTestId('telegram-badge-pending')).toBeInTheDocument();
    expect(screen.getByTestId('telegram-link-btn')).toHaveTextContent(/Continuar/);
  });

  it('3. linked con username → Badge "Conectado ✓ @username" + botón "Desvincular"', () => {
    render(
      <TelegramChannelRow
        initialState={{ kind: 'linked', username: 'lautaroe', blocked: false }}
      />,
    );

    const row = screen.getByTestId('row-telegram');
    expect(row).toHaveAttribute('data-state', 'linked');
    const badge = screen.getByTestId('telegram-badge-linked');
    expect(badge).toHaveTextContent(/Conectado/);
    expect(badge).toHaveTextContent(/@lautaroe/);
    expect(screen.getByTestId('telegram-unlink-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('telegram-link-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('telegram-blocked-alert')).not.toBeInTheDocument();
  });

  it('4. linked sin username → Badge muestra "Conectado ✓" sin @', () => {
    render(
      <TelegramChannelRow initialState={{ kind: 'linked', username: null, blocked: false }} />,
    );

    const badge = screen.getByTestId('telegram-badge-linked');
    expect(badge).toHaveTextContent(/Conectado/);
    expect(badge).not.toHaveTextContent('@');
  });

  it('5. linked con blocked=true → Alert destructive visible', () => {
    render(
      <TelegramChannelRow initialState={{ kind: 'linked', username: 'foo', blocked: true }} />,
    );

    expect(screen.getByTestId('telegram-blocked-alert')).toBeInTheDocument();
    expect(screen.getByTestId('telegram-blocked-alert')).toHaveTextContent(/bloqueado/i);
  });
});
