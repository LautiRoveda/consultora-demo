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
    // T-029: Calendario paso de soon → live. T-035: Notificaciones salio del sidebar
    // (vive como sub-tab de Configuracion). T-049: Clientes paso de soon → live.
    // Total 7 (4 live + 2 soon + 1 settings).
    expect(items.length).toBe(7);

    const expectedSoonLabels = ['Empleados', 'EPP'];
    const soonButtons = nav.querySelectorAll<HTMLButtonElement>(
      'button[aria-disabled="true"][disabled]',
    );
    expect(soonButtons.length).toBe(expectedSoonLabels.length);

    for (const expected of expectedSoonLabels) {
      const match = Array.from(soonButtons).find((btn) => btn.textContent?.includes(expected));
      expect(match, `no se encontró button "soon" para ${expected}`).toBeDefined();
    }
  });

  it('Calendario es link live (T-029) — sin aria-current en /dashboard', () => {
    renderNav();
    const link = screen.getByRole('link', { name: /Calendario/i });
    expect(link).toHaveAttribute('href', '/calendario');
    expect(link).not.toHaveAttribute('aria-current', 'page');
  });

  it('Clientes es link live (T-049) — sin aria-current en /dashboard', () => {
    renderNav();
    const link = screen.getByRole('link', { name: /Clientes/i });
    expect(link).toHaveAttribute('href', '/clientes');
    expect(link).not.toHaveAttribute('aria-current', 'page');
  });
});
