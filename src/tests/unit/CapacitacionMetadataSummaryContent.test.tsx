import type { CapacitacionMetadata } from '@/shared/templates/capacitacion/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CapacitacionMetadataSummaryContent } from '@/shared/templates/capacitacion/CapacitacionMetadataSummaryContent';

afterEach(() => {
  cleanup();
});

const fullFixture: CapacitacionMetadata = {
  razon_social: 'Logística del Sur SA',
  cuit: '30-55554444-3',
  domicilio: 'Ruta 8 km 42',
  fecha_capacitacion: '2026-03-15',
  modalidad: 'presencial',
  duracion_horas: 3,
  tema_principal: 'Uso correcto de EPP en maniobras de carga',
  capacitador_nombre: 'Ing. Lautaro Vidal',
  capacitador_matricula: 'MN 12345',
  cantidad_asistentes_prevista: 22,
  contenidos_resumen: 'Selección de calzado de seguridad, arnés y guantes anti-corte.',
};

const minimalFixture: CapacitacionMetadata = {
  razon_social: 'Servicios Generales SRL',
  cuit: '30-11223344-5',
  domicilio: 'Av. Belgrano 200',
  fecha_capacitacion: '2026-04-01',
  modalidad: 'virtual',
  duracion_horas: 1.5,
  tema_principal: 'Riesgos eléctricos básicos',
  capacitador_nombre: 'Carlos Pérez',
  cantidad_asistentes_prevista: 12,
};

describe('CapacitacionMetadataSummaryContent', () => {
  it('renderiza h2, badge "Datos completos" y todos los campos con fixture full', () => {
    render(<CapacitacionMetadataSummaryContent metadata={fullFixture} />);

    expect(screen.getByText('Datos de la capacitación')).toBeInTheDocument();
    expect(screen.getByText('Datos completos')).toBeInTheDocument();
    expect(screen.getByText(fullFixture.razon_social)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.cuit)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.domicilio)).toBeInTheDocument();
    expect(screen.getByText('15/03/2026')).toBeInTheDocument();
    expect(screen.getByText('Presencial')).toBeInTheDocument();
    expect(screen.getByText('3 h')).toBeInTheDocument();
    expect(screen.getByText(fullFixture.tema_principal)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.capacitador_nombre)).toBeInTheDocument();
    expect(screen.getByText('MN 12345')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(
      screen.getByText('Selección de calzado de seguridad, arnés y guantes anti-corte.'),
    ).toBeInTheDocument();
  });

  it('omite optionals (matricula, contenidos_resumen) y marca "Datos parciales" con minimal', () => {
    render(<CapacitacionMetadataSummaryContent metadata={minimalFixture} />);

    expect(screen.getByText('Datos parciales')).toBeInTheDocument();
    expect(screen.queryByText('Matrícula')).not.toBeInTheDocument();
    expect(screen.queryByText('Contenidos resumidos')).not.toBeInTheDocument();
    expect(screen.getByText(minimalFixture.razon_social)).toBeInTheDocument();
    expect(screen.getByText('Virtual')).toBeInTheDocument();
    expect(screen.getByText('1.5 h')).toBeInTheDocument();
  });
});
