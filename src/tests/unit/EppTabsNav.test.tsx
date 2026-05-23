import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EppTabsNav } from '@/app/(app)/epp/EppTabsNav';

const usePathnameMock = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

afterEach(() => {
  cleanup();
  usePathnameMock.mockReset();
});

describe('EppTabsNav (T-102-FU1)', () => {
  it('renderea 2 tabs (Catálogo + Entregas) con sus hrefs', () => {
    usePathnameMock.mockReturnValue('/epp/catalogo');
    render(<EppTabsNav />);

    const catalogo = screen.getByRole('tab', { name: /Catálogo/i });
    const entregas = screen.getByRole('tab', { name: /Entregas/i });

    expect(catalogo).toHaveAttribute('href', '/epp/catalogo');
    expect(entregas).toHaveAttribute('href', '/epp/entregas');
  });

  it('marca "Catálogo" activo cuando pathname === /epp/catalogo', () => {
    usePathnameMock.mockReturnValue('/epp/catalogo');
    render(<EppTabsNav />);

    const catalogo = screen.getByRole('tab', { name: /Catálogo/i });
    const entregas = screen.getByRole('tab', { name: /Entregas/i });

    expect(catalogo).toHaveAttribute('aria-current', 'page');
    expect(catalogo).toHaveAttribute('aria-selected', 'true');
    expect(entregas).not.toHaveAttribute('aria-current', 'page');
    expect(entregas).toHaveAttribute('aria-selected', 'false');
  });

  it('marca "Entregas" activo cuando pathname === /epp/entregas/nueva (startsWith match)', () => {
    usePathnameMock.mockReturnValue('/epp/entregas/nueva');
    render(<EppTabsNav />);

    const catalogo = screen.getByRole('tab', { name: /Catálogo/i });
    const entregas = screen.getByRole('tab', { name: /Entregas/i });

    expect(entregas).toHaveAttribute('aria-current', 'page');
    expect(entregas).toHaveAttribute('aria-selected', 'true');
    expect(catalogo).not.toHaveAttribute('aria-current', 'page');
    expect(catalogo).toHaveAttribute('aria-selected', 'false');
  });

  it('marca "Catálogo" activo cuando pathname === /epp/catalogo/items (startsWith match)', () => {
    usePathnameMock.mockReturnValue('/epp/catalogo/items');
    render(<EppTabsNav />);

    const catalogo = screen.getByRole('tab', { name: /Catálogo/i });

    expect(catalogo).toHaveAttribute('aria-current', 'page');
  });
});
