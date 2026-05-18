/**
 * T-049 · Tests del ClientesList (empty state + render + status badge + search + toggle).
 */
import type { ClienteRow } from '@/app/(app)/clientes/queries';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientesList } from '@/app/(app)/clientes/ClientesList';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// jsdom no implementa ResizeObserver/PointerCapture. Necesarios si Radix
// primitivos se montan (el Switch usa pointer events).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

afterEach(() => cleanup());
beforeEach(() => {
  vi.useFakeTimers();
  pushMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

function makeCliente(overrides: Partial<ClienteRow> = {}): ClienteRow {
  return {
    id: 'cli-' + Math.random().toString(36).slice(2, 8),
    consultora_id: 'cons-1',
    razon_social: 'Acme S.A.',
    cuit: '30-12345678-9',
    nombre_fantasia: null,
    domicilio: null,
    localidad: null,
    provincia: null,
    contacto_nombre: null,
    contacto_email: null,
    contacto_telefono: null,
    industria: null,
    art: null,
    notas: null,
    archived_at: null,
    created_by: 'user-1',
    created_at: '2026-05-01T10:00:00.000Z',
    updated_at: '2026-05-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('ClientesList', () => {
  it('empty state real (sin clientes + sin filtros) → muestra CTA "Crear primer cliente"', () => {
    render(<ClientesList clientes={[]} initialQ="" initialIncludeArchived={false} />);
    expect(screen.getByText('Todavía no tenés clientes')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Crear primer cliente' });
    expect(cta).toHaveAttribute('href', '/clientes/nuevo');
  });

  it('render con 2 clientes activos → 2 cards con sus razones sociales', () => {
    const c1 = makeCliente({ razon_social: 'Acme S.A.', cuit: '30-11111111-1' });
    const c2 = makeCliente({ razon_social: 'Empresa Beta', cuit: '30-22222222-2' });
    render(<ClientesList clientes={[c1, c2]} initialQ="" initialIncludeArchived={false} />);
    expect(screen.getByText('Acme S.A.')).toBeInTheDocument();
    expect(screen.getByText('Empresa Beta')).toBeInTheDocument();
  });

  it('status badge: solo el cliente archivado muestra el Badge', () => {
    const activo = makeCliente({ razon_social: 'Activo Co', cuit: '30-33333333-3' });
    const archivado = makeCliente({
      razon_social: 'Archivado Co',
      cuit: '30-44444444-4',
      archived_at: '2026-05-10T10:00:00.000Z',
    });
    render(
      <ClientesList clientes={[activo, archivado]} initialQ="" initialIncludeArchived={true} />,
    );
    const badges = screen.getAllByText('Archivado');
    expect(badges.length).toBe(1);
  });

  it('search client-side: matchea razon_social, nombre_fantasia y cuit (con CUIT normalize)', () => {
    const cAcme = makeCliente({
      id: 'c-acme',
      razon_social: 'Acme Industrial S.A.',
      cuit: '30-12345678-9',
      nombre_fantasia: null,
    });
    const cGalpon = makeCliente({
      id: 'c-galpon',
      razon_social: 'Servicios del Sur SRL',
      cuit: '30-22222222-2',
      nombre_fantasia: 'El Galpón',
    });
    const cOtro = makeCliente({
      id: 'c-otro',
      razon_social: 'Otra Empresa',
      cuit: '30-33333333-3',
      nombre_fantasia: null,
    });
    const clientes = [cAcme, cGalpon, cOtro];

    // (a) Match por razon_social: "Acme" → solo cAcme.
    render(<ClientesList clientes={clientes} initialQ="Acme" initialIncludeArchived={false} />);
    expect(screen.getByText('Acme Industrial S.A.')).toBeInTheDocument();
    expect(screen.queryByText('Servicios del Sur SRL')).not.toBeInTheDocument();
    expect(screen.queryByText('Otra Empresa')).not.toBeInTheDocument();
    cleanup();

    // (b) Match por nombre_fantasia: "Galpón" → solo cGalpon.
    render(<ClientesList clientes={clientes} initialQ="Galpón" initialIncludeArchived={false} />);
    expect(screen.queryByText('Acme Industrial S.A.')).not.toBeInTheDocument();
    expect(screen.getByText('Servicios del Sur SRL')).toBeInTheDocument();
    cleanup();

    // (c) Match por CUIT sin guiones: el input "30123456789" matchea con
    // cuit DB "30-12345678-9" (digits-only ambos lados).
    render(
      <ClientesList clientes={clientes} initialQ="30123456789" initialIncludeArchived={false} />,
    );
    expect(screen.getByText('Acme Industrial S.A.')).toBeInTheDocument();
    expect(screen.queryByText('Servicios del Sur SRL')).not.toBeInTheDocument();
    expect(screen.queryByText('Otra Empresa')).not.toBeInTheDocument();
  });

  it('toggle "Ver archivados" dispara router.push con ?archived=1', () => {
    const cliente = makeCliente();
    render(<ClientesList clientes={[cliente]} initialQ="" initialIncludeArchived={false} />);
    const toggle = screen.getByRole('switch', { name: /Ver archivados/i });
    fireEvent.click(toggle);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/clientes?archived=1');
  });
});
