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

  it('no quedan items "soon": todos los nav items son links live', () => {
    renderNav();
    // T-029: Calendario soon → live. T-035: Notificaciones salio del sidebar
    // (vive como sub-tab de Configuracion). T-049: Clientes soon → live.
    // T-054: Empleados soon → live. T-101: EPP soon → live (redirige a
    // /epp/catalogo hasta que T-106 traiga padron). T-063: Accidentabilidad
    // live. Total 8 items, todos live.
    const nav = screen.getByRole('navigation');
    const items = nav.querySelectorAll('li');
    expect(items.length).toBe(8);

    const soonButtons = nav.querySelectorAll<HTMLButtonElement>(
      'button[aria-disabled="true"][disabled]',
    );
    expect(soonButtons.length).toBe(0);

    // EPP ahora es link live → href /epp.
    const eppLink = screen.getByRole('link', { name: /EPP/i });
    expect(eppLink).toHaveAttribute('href', '/epp');
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

  it('Empleados es link live (T-054) — sin aria-current en /dashboard', () => {
    renderNav();
    const link = screen.getByRole('link', { name: /Empleados/i });
    expect(link).toHaveAttribute('href', '/empleados');
    expect(link).not.toHaveAttribute('aria-current', 'page');
  });

  it('Accidentabilidad es link live (T-063) — sin aria-current en /dashboard', () => {
    renderNav();
    const link = screen.getByRole('link', { name: /Accidentabilidad/i });
    expect(link).toHaveAttribute('href', '/accidentabilidad');
    expect(link).not.toHaveAttribute('aria-current', 'page');
  });
});
