/**
 * T-061a · EjecucionRunner: navegación entre secciones, barra de progreso de
 * obligatorios, y la card final según rol (member "pedile al titular" / owner).
 */
import type {
  EjecucionSectionNode,
  ExecutionRespuestaRow,
  TemplateItemRow,
} from '@/app/(app)/checklists/ejecuciones/queries';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EjecucionRunner } from '@/app/(app)/checklists/ejecuciones/EjecucionRunner';

vi.mock('@/app/(app)/checklists/ejecuciones/actions', () => ({
  saveRespuestaAction: vi.fn().mockResolvedValue({ ok: true, respuestaId: 'r-1' }),
  uploadAdjuntoAction: vi.fn(),
  deleteAdjuntoAction: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// jsdom no implementa scrollTo (el runner lo llama al cambiar de sección).
window.scrollTo = vi.fn();

const EXEC = '00000000-0000-0000-0000-0000000000ee';

function item(id: string, overrides: Partial<TemplateItemRow> = {}): TemplateItemRow {
  return {
    id,
    section_id: 's',
    version_id: 'v',
    consultora_id: 'c',
    orden: 1,
    texto: `Ítem ${id}`,
    response_type: 'cumple_no_aplica',
    es_critico: false,
    es_requerido: true,
    referencia_normativa: null,
    config: null,
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function section(id: string, titulo: string, items: TemplateItemRow[]): EjecucionSectionNode {
  return {
    id,
    version_id: 'v',
    consultora_id: 'c',
    orden: 1,
    titulo,
    descripcion: null,
    created_at: '2026-06-01T00:00:00Z',
    items,
  };
}

const sections = [
  section('sa', 'Sección A', [item('i1'), item('i2')]),
  section('sb', 'Sección B', [item('i3')]),
];

// i1 respondido → 1 de 3 obligatorios.
const respuestas: Record<string, ExecutionRespuestaRow> = {
  i1: { id: 'r1', valor: 'si' } as ExecutionRespuestaRow,
};

function renderRunner(isOwner: boolean) {
  return render(
    <EjecucionRunner
      executionId={EXEC}
      isOwner={isOwner}
      sections={sections}
      respuestasByItemId={respuestas}
      adjuntosByItemId={{}}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('EjecucionRunner', () => {
  it('barra de progreso refleja obligatorios respondidos (1 de 3 = 33)', () => {
    renderRunner(false);
    const bar = screen.getByRole('progressbar', { name: /Progreso/i });
    expect(bar).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByText('1 de 3 ítems obligatorios respondidos')).toBeInTheDocument();
  });

  it('Siguiente/Anterior navegan entre secciones', () => {
    renderRunner(false);
    expect(screen.getByText('Sección A')).toBeInTheDocument();
    expect(screen.queryByText('Ítem i3')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(screen.getByText('Ítem i3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Anterior/ }));
    expect(screen.getByText('Ítem i1')).toBeInTheDocument();
  });

  it('última sección: member ve "pedile al titular"', () => {
    renderRunner(false);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(screen.getByText(/Pedile al titular/i)).toBeInTheDocument();
    expect(screen.queryByText(/vas a poder cerrar y firmar/i)).not.toBeInTheDocument();
  });

  it('última sección incompleta: owner ve "Cierre con firma" (no "pedile al titular", no CTA)', () => {
    renderRunner(true);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(screen.getByText(/Cierre con firma/i)).toBeInTheDocument();
    expect(screen.queryByText(/Pedile al titular/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Cerrar y firmar inspección/i }),
    ).not.toBeInTheDocument();
  });

  it('última sección completa: owner ve el CTA "Cerrar y firmar" → /cerrar (T-061b)', () => {
    const todas: Record<string, ExecutionRespuestaRow> = {
      i1: { id: 'r1', valor: 'si' } as ExecutionRespuestaRow,
      i2: { id: 'r2', valor: 'si' } as ExecutionRespuestaRow,
      i3: { id: 'r3', valor: 'si' } as ExecutionRespuestaRow,
    };
    render(
      <EjecucionRunner
        executionId={EXEC}
        isOwner
        sections={sections}
        respuestasByItemId={todas}
        adjuntosByItemId={{}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    const cta = screen.getByRole('link', { name: /Cerrar y firmar inspección/i });
    expect(cta).toHaveAttribute('href', `/checklists/ejecuciones/${EXEC}/cerrar`);
  });
});
