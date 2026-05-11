import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppUserMenu } from '@/shared/ui/app-shell/AppUserMenu';

// `vi.hoisted` evita ReferenceError: vitest hoist `vi.mock` al tope, así
// la const dummy debe estar disponible en el orden hoisted.
const signOutMock = vi.hoisted(() => vi.fn());
vi.mock('@/shared/auth/actions', () => ({
  signOutAction: signOutMock,
}));

// Cleanup explícito porque vitest no tiene `globals: true`.
afterEach(() => {
  cleanup();
});

describe('AppUserMenu', () => {
  it('muestra el email en el trigger button', () => {
    render(<AppUserMenu email="lautaro@example.com" />);
    // El email aparece dentro del trigger (DropdownMenu cerrado por default).
    expect(screen.getByText('lautaro@example.com')).toBeInTheDocument();
  });

  it('genera iniciales desde local-part del email (cuenta separator . - _ +)', () => {
    render(<AppUserMenu email="laura.gomez@empresa.com" />);
    // Avatar fallback con iniciales: "LG".
    expect(screen.getByText('LG')).toBeInTheDocument();
  });

  it('iniciales para email sin separadores → primera letra solamente', () => {
    render(<AppUserMenu email="lautaro@example.com" />);
    expect(screen.getByText('L')).toBeInTheDocument();
  });
});
