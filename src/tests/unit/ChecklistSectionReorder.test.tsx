/**
 * T-059 · Test del reorder de ítems en SectionCard: el botón ↑/↓ computa el array
 * COMPLETO reordenado (swap del par adyacente) y lo manda a reorderItemsAction.
 * Disabled en los extremos (WCAG).
 */
import type { TemplateSectionNode } from '@/app/(app)/checklists/queries';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SectionCard } from '@/app/(app)/checklists/[id]/SectionCard';

const { refreshMock, reorderItemsMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  reorderItemsMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock, back: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/app/(app)/checklists/actions', () => ({
  reorderItemsAction: (input: unknown) => reorderItemsMock(input),
  deleteSectionAction: vi.fn(),
  deleteItemAction: vi.fn(),
  addItemAction: vi.fn(),
  updateItemAction: vi.fn(),
  addSectionAction: vi.fn(),
  updateSectionAction: vi.fn(),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

function makeItem(id: string, texto: string, orden: number) {
  return {
    id,
    section_id: 'sec-1',
    version_id: 'ver-1',
    consultora_id: 'c-1',
    orden,
    texto,
    response_type: 'cumple_no_aplica',
    es_critico: false,
    es_requerido: true,
    referencia_normativa: null,
    config: null,
    created_at: '2026-06-03T00:00:00.000Z',
  };
}

const section = {
  id: 'sec-1',
  version_id: 'ver-1',
  consultora_id: 'c-1',
  orden: 0,
  titulo: 'Generalidades',
  descripcion: null,
  created_at: '2026-06-03T00:00:00.000Z',
  items: [
    makeItem('it-a', 'Ítem A', 0),
    makeItem('it-b', 'Ítem B', 1),
    makeItem('it-c', 'Ítem C', 2),
  ],
} as unknown as TemplateSectionNode;

function renderCard() {
  render(
    <SectionCard
      section={section}
      index={0}
      total={1}
      onMoveSection={vi.fn()}
      sectionsBusy={false}
    />,
  );
}

beforeEach(() => {
  refreshMock.mockReset();
  reorderItemsMock.mockReset();
  reorderItemsMock.mockResolvedValue({ ok: true });
});
afterEach(() => cleanup());

describe('SectionCard reorder de ítems', () => {
  it('subir el ítem B manda orderedIds con B y A swapeados', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Subir «Ítem B»' }));

    await waitFor(() => expect(reorderItemsMock).toHaveBeenCalledTimes(1));
    expect(reorderItemsMock.mock.calls[0]![0]).toEqual({
      sectionId: 'sec-1',
      orderedIds: ['it-b', 'it-a', 'it-c'],
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('bajar el ítem B manda orderedIds con B y C swapeados', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Bajar «Ítem B»' }));

    await waitFor(() => expect(reorderItemsMock).toHaveBeenCalledTimes(1));
    expect(reorderItemsMock.mock.calls[0]![0]).toEqual({
      sectionId: 'sec-1',
      orderedIds: ['it-a', 'it-c', 'it-b'],
    });
  });

  it('↑ del primer ítem y ↓ del último están disabled (WCAG)', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Subir «Ítem A»' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bajar «Ítem C»' })).toBeDisabled();
  });
});
