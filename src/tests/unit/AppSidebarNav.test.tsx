import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppSidebarNav } from '@/shared/ui/app-shell/AppSidebarNav';
import { TooltipProvider } from '@/shared/ui/tooltip';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

// vitest no tiene `globals: true` configurado, así que testing-library no
// auto-cleanup entre tests. Sin esto, cada render apila DOM y los `getByRole`
// encuentran múltiples elementos.
afterEach(() => {
  cleanup();
});

function renderNav() {
  return render(
    <TooltipProvider>
      <AppSidebarNav />
    </TooltipProvider>,
  );
}

describe('AppSidebarNav', () => {
  it('renderiza Dashboard como link activo con aria-current=page', () => {
    renderNav();
    const link = screen.getByRole('link', { name: /Dashboard/i });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toHaveAttribute('href', '/dashboard');
  });

  it('renderiza Informes como link live (T-019) — sin aria-current por default', () => {
    renderNav();
    const link = screen.getByRole('link', { name: /Informes/i });
    expect(link).toHaveAttribute('href', '/informes');
    expect(link).not.toHaveAttribute('aria-current', 'page');
  });

  it('los items "soon" están deshabilitados y muestran sus labels', () => {
    renderNav();
    // Iteramos directamente sobre los <li> del nav y testeamos uno por uno.
    // Evitamos `getBy*` con name regex porque Radix Tooltip puede duplicar
    // el accessible-name en jsdom (visible + sr-only).
    const nav = screen.getByRole('navigation');
    const items = nav.querySelectorAll('li');
    expect(items.length).toBe(7);

    const expectedSoonLabels = ['Clientes', 'Empleados', 'EPP', 'Calendario', 'Notificaciones'];
    const soonButtons = nav.querySelectorAll<HTMLButtonElement>(
      'button[aria-disabled="true"][disabled]',
    );
    expect(soonButtons.length).toBe(expectedSoonLabels.length);

    for (const expected of expectedSoonLabels) {
      const match = Array.from(soonButtons).find((btn) => btn.textContent?.includes(expected));
      expect(match, `no se encontró button "soon" para ${expected}`).toBeDefined();
    }
  });
});
