import type { RelevamientoMetadata } from '@/shared/templates/relevamiento/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RelevamientoMetadataSummaryContent } from '@/shared/templates/relevamiento/RelevamientoMetadataSummaryContent';

afterEach(() => {
  cleanup();
});

const fullFixture: RelevamientoMetadata = {
  razon_social: 'Frigorífico San José SA',
  cuit: '30-77665544-1',
  domicilio: 'Camino Rural 5',
  localidad: 'Ramallo',
  provincia: 'BA',
  fecha_relevamiento: '2026-05-08',
  areas_relevadas: ['Sala de despostado', 'Cámara fría', 'Sala de máquinas'],
  agentes_a_relevar: ['ruido', 'carga_termica', 'iluminacion'],
  equipos_medicion: 'Sonómetro Cirrus CR:171B, luxómetro Extech LT45, índice WBGT QUEST.',
};

const minimalFixture: RelevamientoMetadata = {
  razon_social: 'Taller Mecánico Norte',
  cuit: '30-33445566-7',
  domicilio: 'Av. San Martín 999',
  localidad: 'San Miguel',
  provincia: 'BA',
  fecha_relevamiento: '2026-05-01',
  areas_relevadas: ['Box de reparaciones'],
  agentes_a_relevar: ['ruido'],
};

describe('RelevamientoMetadataSummaryContent', () => {
  it('renderiza h2, badge "Datos completos", areas + agentes + equipos con full', () => {
    render(<RelevamientoMetadataSummaryContent metadata={fullFixture} />);

    expect(screen.getByText('Datos del relevamiento')).toBeInTheDocument();
    expect(screen.getByText('Datos completos')).toBeInTheDocument();
    expect(screen.getByText(fullFixture.razon_social)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.cuit)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.domicilio)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.localidad)).toBeInTheDocument();
    expect(screen.getByText('Buenos Aires (BA)')).toBeInTheDocument();
    expect(screen.getByText('08/05/2026')).toBeInTheDocument();
    expect(screen.getByText('Sala de despostado')).toBeInTheDocument();
    expect(screen.getByText('Cámara fría')).toBeInTheDocument();
    expect(screen.getByText('Sala de máquinas')).toBeInTheDocument();
    expect(screen.getByText('Ruido')).toBeInTheDocument();
    expect(screen.getByText('Carga térmica (WBGT)')).toBeInTheDocument();
    expect(screen.getByText('Iluminación')).toBeInTheDocument();
    expect(
      screen.getByText('Sonómetro Cirrus CR:171B, luxómetro Extech LT45, índice WBGT QUEST.'),
    ).toBeInTheDocument();
  });

  it('omite equipos_medicion y marca "Datos parciales" con minimal', () => {
    render(<RelevamientoMetadataSummaryContent metadata={minimalFixture} />);

    expect(screen.getByText('Datos parciales')).toBeInTheDocument();
    expect(screen.queryByText('Equipos de medición')).not.toBeInTheDocument();
    expect(screen.getByText(minimalFixture.razon_social)).toBeInTheDocument();
    expect(screen.getByText('Box de reparaciones')).toBeInTheDocument();
    expect(screen.getByText('Ruido')).toBeInTheDocument();
  });
});
