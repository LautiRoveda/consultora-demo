/**
 * T-101 · Tests del ItemForm (cross-field es_descartable ↔ vida_util_meses +
 * requiere_numero_serie hint visible).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItemForm } from '@/app/(app)/epp/catalogo/ItemForm';

const { pushMock, refreshMock, backMock, toastErrorMock, createMock, updateMock } = vi.hoisted(
  () => ({
    pushMock: vi.fn(),
    refreshMock: vi.fn(),
    backMock: vi.fn(),
    toastErrorMock: vi.fn(),
    createMock: vi.fn(),
    updateMock: vi.fn(),
  }),
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    refresh: refreshMock,
    back: backMock,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: toastErrorMock,
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/app/(app)/epp/catalogo/actions', () => ({
  createItemAction: (input: unknown) => createMock(input),
  updateItemAction: (id: unknown, patch: unknown) => updateMock(id, patch),
  archiveItemAction: vi.fn(),
  restoreItemAction: vi.fn(),
}));

// Stubs jsdom requeridos por Radix Select.
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

const categorias = [
  { id: '11111111-1111-1111-1111-111111111111', nombre: 'Protección cabeza' },
  { id: '22222222-2222-2222-2222-222222222222', nombre: 'Protección manos' },
];

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
  backMock.mockReset();
  toastErrorMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
});
afterEach(() => cleanup());

describe('ItemForm', () => {
  it('mode=create renderiza secciones + fields requeridos con asterisco', () => {
    render(<ItemForm mode="create" categorias={categorias} />);
    expect(screen.getByText('Identificación')).toBeInTheDocument();
    expect(screen.getByText('Tipo de EPP')).toBeInTheDocument();
    expect(screen.getByText('Marca / modelo / normativa')).toBeInTheDocument();
    expect(screen.getByText('Nombre *')).toBeInTheDocument();
    expect(screen.getByText('Categoría *')).toBeInTheDocument();
    expect(screen.getByText('Vida útil (meses) *')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear item/i })).toBeInTheDocument();
  });

  it('toggle es_descartable=true → input vida_util_meses queda disabled', () => {
    render(<ItemForm mode="create" categorias={categorias} />);
    const vidaInput = screen.getByLabelText<HTMLInputElement>(/Vida útil/i);
    expect(vidaInput.disabled).toBe(false);

    const descartableSwitch = screen.getByRole('switch', { name: /Toggle descartable/i });
    fireEvent.click(descartableSwitch);

    expect(vidaInput.disabled).toBe(true);
    expect(screen.getByText(/No aplica para EPP descartable/i)).toBeInTheDocument();
  });

  it('toggle es_descartable=true cuando requiere_numero_serie=true → se resetea serie y queda disabled', () => {
    render(<ItemForm mode="create" categorias={categorias} />);
    const serieSwitch = screen.getByRole('switch', { name: /Toggle requiere número de serie/i });
    fireEvent.click(serieSwitch);
    expect(serieSwitch).toHaveAttribute('aria-checked', 'true');

    const descartableSwitch = screen.getByRole('switch', { name: /Toggle descartable/i });
    fireEvent.click(descartableSwitch);

    // descartable + requiere_serie son mutuamente excluyentes: serie se apaga
    // automáticamente, y el switch queda disabled.
    expect(serieSwitch).toHaveAttribute('aria-checked', 'false');
    expect(serieSwitch).toBeDisabled();
  });

  it('mode=edit pre-popula fields y muestra hint serie cuando requiere_numero_serie=true', () => {
    render(
      <ItemForm
        mode="edit"
        itemId="item-1"
        categorias={categorias}
        initialValues={{
          id: 'item-1',
          consultora_id: 'c-1',
          categoria_id: '11111111-1111-1111-1111-111111111111',
          nombre: 'Arnés cuerpo entero',
          marca_default: 'MSA',
          modelo_default: 'V-Form',
          vida_util_meses: 12,
          es_descartable: false,
          requiere_numero_serie: true,
          normativa: 'IRAM 3622',
          notas: null,
          archived_at: null,
          created_by: 'u-1',
          created_at: '2026-05-01T10:00:00.000Z',
          updated_at: '2026-05-01T10:00:00.000Z',
        }}
      />,
    );
    expect(screen.getByDisplayValue('Arnés cuerpo entero')).toBeInTheDocument();
    expect(screen.getByDisplayValue('IRAM 3622')).toBeInTheDocument();
    expect(screen.getByDisplayValue('MSA')).toBeInTheDocument();
    expect(screen.getByText(/Cada entrega va a exigir el número de serie/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar cambios/i })).toBeInTheDocument();
  });
});
