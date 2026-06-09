/**
 * T-063-FU1 · Tests del HistorialTimeline (resaltado de campos que cambiaron
 * respecto de la versión que reemplazó a cada versión previa).
 */
import type { IncidenteRow } from '@/app/(app)/accidentabilidad/queries';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HistorialTimeline } from '@/app/(app)/accidentabilidad/[id]/HistorialTimeline';

function makeIncidente(overrides: Partial<IncidenteRow> = {}): IncidenteRow {
  return {
    id: 'inc-vigente',
    consultora_id: 'cons-1',
    cliente_id: null,
    empleado_id: null,
    tipo: 'accidente',
    fecha: '2026-05-20',
    hora: '10:00:00',
    lugar_especifico: 'Sector nuevo',
    descripcion: 'Descripción nueva del hecho.',
    causa_raiz: null,
    accion_inmediata: null,
    gravedad: 'grave',
    dias_perdidos: 5,
    informe_id: null,
    corrige_id: null,
    anulacion: false,
    created_by: 'user-1',
    created_at: '2026-05-20T13:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('HistorialTimeline', () => {
  it('marca con chip "cambió" los campos que difieren de la versión que la reemplazó', () => {
    const vigente = makeIncidente({
      id: 'v',
      lugar_especifico: 'Sector nuevo',
      descripcion: 'Desc nueva',
    });
    // La versión previa difiere SOLO en lugar + descripción.
    const previa = makeIncidente({
      id: 'p1',
      created_at: '2026-05-19T13:00:00.000Z',
      lugar_especifico: 'Sector viejo',
      descripcion: 'Desc vieja',
    });

    render(<HistorialTimeline vigente={vigente} historial={[previa]} />);

    // 2 campos cambiaron → 2 chips.
    expect(screen.getAllByText('cambió')).toHaveLength(2);
    // Muestra los valores VIEJOS de la versión previa.
    expect(screen.getByText('Sector viejo')).toBeInTheDocument();
    expect(screen.getByText('Desc vieja')).toBeInTheDocument();
  });

  it('compara cada previa contra la inmediatamente más nueva y no marca lo que no cambió', () => {
    const vigente = makeIncidente({ id: 'v', gravedad: 'mortal' });
    // La previa difiere SOLO en gravedad (grave vs mortal del vigente).
    const previa = makeIncidente({
      id: 'p1',
      created_at: '2026-05-19T13:00:00.000Z',
      gravedad: 'grave',
    });

    render(<HistorialTimeline vigente={vigente} historial={[previa]} />);

    expect(screen.getAllByText('cambió')).toHaveLength(1);
    // El label de gravedad de la previa (la que cambió).
    expect(screen.getByText('Grave (baja prolongada)')).toBeInTheDocument();
    // Tipo no cambió → se muestra pero sin sumar otro chip.
    expect(screen.getByText('Accidente (con lesión)')).toBeInTheDocument();
  });

  it('compara la primera versión previa contra el incidente vigente', () => {
    // El vigente es casi_accidente; la previa era accidente → tipo cambió.
    const vigente = makeIncidente({ id: 'v', tipo: 'casi_accidente', gravedad: null });
    const previa = makeIncidente({
      id: 'p1',
      created_at: '2026-05-19T13:00:00.000Z',
      tipo: 'accidente',
      gravedad: 'grave',
    });

    render(<HistorialTimeline vigente={vigente} historial={[previa]} />);

    // tipo + gravedad difieren respecto del vigente → 2 chips.
    expect(screen.getAllByText('cambió')).toHaveLength(2);
  });
});
