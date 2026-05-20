import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClienteTabsNav } from '@/app/(app)/clientes/[id]/ClienteTabsNav';

const usePathnameMock = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

afterEach(() => {
  cleanup();
  usePathnameMock.mockReset();
});

const CLIENTE_ID = 'abc-123';

describe('ClienteTabsNav (T-055)', () => {
  it('marca "Detalle" como activo cuando pathname === /clientes/[id]', () => {
    usePathnameMock.mockReturnValue(`/clientes/${CLIENTE_ID}`);
    render(<ClienteTabsNav clienteId={CLIENTE_ID} />);

    const detalle = screen.getByRole('tab', { name: /Detalle/i });
    const empleados = screen.getByRole('tab', { name: /Empleados/i });

    expect(detalle).toHaveAttribute('aria-current', 'page');
    expect(detalle).toHaveAttribute('aria-selected', 'true');
    expect(empleados).not.toHaveAttribute('aria-current', 'page');
    expect(empleados).toHaveAttribute('aria-selected', 'false');
  });

  it('marca "Empleados" como activo cuando pathname === /clientes/[id]/empleados', () => {
    usePathnameMock.mockReturnValue(`/clientes/${CLIENTE_ID}/empleados`);
    render(<ClienteTabsNav clienteId={CLIENTE_ID} />);

    const detalle = screen.getByRole('tab', { name: /Detalle/i });
    const empleados = screen.getByRole('tab', { name: /Empleados/i });

    expect(empleados).toHaveAttribute('aria-current', 'page');
    expect(empleados).toHaveAttribute('aria-selected', 'true');
    expect(detalle).not.toHaveAttribute('aria-current', 'page');
    expect(detalle).toHaveAttribute('aria-selected', 'false');
  });

  it('ambos tabs tienen el href correcto (Detalle + Empleados)', () => {
    usePathnameMock.mockReturnValue(`/clientes/${CLIENTE_ID}`);
    render(<ClienteTabsNav clienteId={CLIENTE_ID} />);

    expect(screen.getByRole('tab', { name: /Detalle/i })).toHaveAttribute(
      'href',
      `/clientes/${CLIENTE_ID}`,
    );
    expect(screen.getByRole('tab', { name: /Empleados/i })).toHaveAttribute(
      'href',
      `/clientes/${CLIENTE_ID}/empleados`,
    );
  });

  it('NO highlightea ningún tab cuando pathname === /clientes/[id]/editar (exact match)', () => {
    usePathnameMock.mockReturnValue(`/clientes/${CLIENTE_ID}/editar`);
    render(<ClienteTabsNav clienteId={CLIENTE_ID} />);

    expect(screen.getByRole('tab', { name: /Detalle/i })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('tab', { name: /Empleados/i })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
