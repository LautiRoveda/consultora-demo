import type { RgrlMetadata } from '@/shared/templates/rgrl/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RgrlMetadataSummaryContent } from '@/shared/templates/rgrl/RgrlMetadataSummaryContent';

afterEach(() => {
  cleanup();
});

const fullFixture: RgrlMetadata = {
  razon_social: 'Acme Industrial SA',
  cuit: '30-71234567-8',
  domicilio: 'Av. Mitre 1234',
  localidad: 'Avellaneda',
  provincia: 'BA',
  actividad_principal: 'Fabricación de envases plásticos',
  codigo_ciiu: '2220',
  cantidad_empleados: 45,
  distribucion_turno: 'doble',
  modalidad_operativa: 'industrial',
  art_contratada: 'Provincia ART',
  servicio_hys_modalidad: 'externo',
  areas_relevadas: ['Producción', 'Depósito', 'Oficinas'],
  riesgos_pre_detectados: 'Ruido en sector inyección, polvo en sector molienda.',
  fecha_relevamiento: '2026-05-10',
};

const minimalFixture: RgrlMetadata = {
  razon_social: 'Pyme SRL',
  cuit: '30-99887766-5',
  domicilio: 'Calle Falsa 123',
  localidad: 'Quilmes',
  provincia: 'BA',
  actividad_principal: 'Comercio minorista',
  cantidad_empleados: 8,
  distribucion_turno: 'unico',
  modalidad_operativa: 'comercial',
  art_contratada: 'Galeno ART',
  servicio_hys_modalidad: 'externo',
  areas_relevadas: ['Salón de ventas'],
  fecha_relevamiento: '2026-04-22',
};

describe('RgrlMetadataSummaryContent', () => {
  it('renderiza h2, badge "Datos completos" y todos los campos con fixture full', () => {
    render(<RgrlMetadataSummaryContent metadata={fullFixture} />);

    expect(screen.getByText('Datos del relevamiento')).toBeInTheDocument();
    expect(screen.getByText('Datos completos')).toBeInTheDocument();
    expect(screen.getByText(fullFixture.razon_social)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.cuit)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.domicilio)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.localidad)).toBeInTheDocument();
    expect(screen.getByText('Buenos Aires (BA)')).toBeInTheDocument();
    expect(screen.getByText(fullFixture.actividad_principal)).toBeInTheDocument();
    expect(screen.getByText('2220')).toBeInTheDocument();
    expect(screen.getByText('Provincia ART')).toBeInTheDocument();
    expect(screen.getByText('Externo (consultoría)')).toBeInTheDocument();
    expect(screen.getByText('10/05/2026')).toBeInTheDocument();
    expect(screen.getByText('Producción')).toBeInTheDocument();
    expect(screen.getByText('Depósito')).toBeInTheDocument();
    expect(screen.getByText('Oficinas')).toBeInTheDocument();
    expect(
      screen.getByText('Ruido en sector inyección, polvo en sector molienda.'),
    ).toBeInTheDocument();
  });

  it('omite optionals (codigo_ciiu, riesgos) y marca "Datos parciales" con fixture minimal', () => {
    render(<RgrlMetadataSummaryContent metadata={minimalFixture} />);

    expect(screen.getByText('Datos parciales')).toBeInTheDocument();
    expect(screen.queryByText('Código CIIU')).not.toBeInTheDocument();
    expect(screen.queryByText('Riesgos pre-detectados')).not.toBeInTheDocument();
    expect(screen.getByText(minimalFixture.razon_social)).toBeInTheDocument();
    expect(screen.getByText('Salón de ventas')).toBeInTheDocument();
  });
});
