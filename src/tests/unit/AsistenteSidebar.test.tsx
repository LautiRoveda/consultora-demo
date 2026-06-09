/**
 * T-126 · Tests del sidebar de conversaciones del asistente (AsistenteShell).
 *
 * jsdom + @testing-library. next/link mockeado a un <a> simple; next/navigation,
 * sonner y las server actions mockeadas. El chat (AsistenteChat) se mockea para
 * aislar el sidebar.
 */
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AsistenteShell } from '@/app/(app)/asistente/asistente-shell';

const { pushMock, refreshMock, archiveMock, toastErrorMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  archiveMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock, back: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastErrorMock, info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/app/(app)/asistente/actions', () => ({
  archiveChatConversacionAction: archiveMock,
  persistChatTurnAction: vi.fn(),
}));

// Aislamos el sidebar: el chat se renderiza como un placeholder.
vi.mock('@/app/(app)/asistente/asistente-client', () => ({
  AsistenteChat: () => <div data-testid="chat" />,
}));

const CONVS = [
  { id: 'c1', titulo: 'Primera conversación', updatedAt: '2026-06-06T10:00:00Z' },
  { id: 'c2', titulo: 'Segunda', updatedAt: '2026-06-05T10:00:00Z' },
];

beforeEach(() => {
  archiveMock.mockResolvedValue({ ok: true, conversacionId: 'c2' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AsistenteShell · sidebar de conversaciones (T-126)', () => {
  it('lista las conversaciones con link a /asistente?c=<id>', () => {
    render(
      <AsistenteShell conversaciones={CONVS} activeConversacionId={null} initialMessages={[]} />,
    );
    expect(screen.getByRole('link', { name: 'Primera conversación' })).toHaveAttribute(
      'href',
      '/asistente?c=c1',
    );
    expect(screen.getByRole('link', { name: 'Segunda' })).toHaveAttribute(
      'href',
      '/asistente?c=c2',
    );
  });

  it('"Nueva conversación" apunta a /asistente', () => {
    render(
      <AsistenteShell conversaciones={CONVS} activeConversacionId={null} initialMessages={[]} />,
    );
    expect(screen.getByRole('link', { name: /Nueva conversación/ })).toHaveAttribute(
      'href',
      '/asistente',
    );
  });

  it('marca la conversación activa con aria-current', () => {
    render(
      <AsistenteShell conversaciones={CONVS} activeConversacionId="c1" initialMessages={[]} />,
    );
    expect(screen.getByRole('link', { name: 'Primera conversación' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Segunda' })).not.toHaveAttribute('aria-current');
  });

  it('archivar una conversación no activa llama al action y refresca la lista', async () => {
    render(
      <AsistenteShell conversaciones={CONVS} activeConversacionId={null} initialMessages={[]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archivar conversación: Segunda' }));

    await waitFor(() => expect(archiveMock).toHaveBeenCalledWith('c2'));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('archivar la conversación activa navega a /asistente', async () => {
    archiveMock.mockResolvedValueOnce({ ok: true, conversacionId: 'c1' });
    render(
      <AsistenteShell conversaciones={CONVS} activeConversacionId="c1" initialMessages={[]} />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Archivar conversación: Primera conversación' }),
    );

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/asistente'));
  });

  it('muestra estado vacío cuando no hay conversaciones', () => {
    render(<AsistenteShell conversaciones={[]} activeConversacionId={null} initialMessages={[]} />);
    expect(screen.getByText('Todavía no tenés conversaciones guardadas.')).toBeInTheDocument();
  });
});
