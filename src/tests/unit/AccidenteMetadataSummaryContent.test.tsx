import type { AccidenteMetadata } from '@/shared/templates/accidente/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AccidenteMetadataSummaryContent } from '@/shared/templates/accidente/AccidenteMetadataSummaryContent';

afterEach(() => {
  cleanup();
});

const fullFixture: AccidenteMetadata = {
  razon_social: 'Metalúrgica Don Pedro SRL',
  cuit: '30-44556677-8',
  domicilio: 'Av. Industria 4500',
  fecha_accidente: '2026-04-18',
  hora_accidente: '14:30',
  lugar_especifico: 'Sector de prensa hidráulica 3',
  puesto_afectado: 'Operario de prensa',
  tipo_lesion: ['contusion', 'esguince'],
  partes_cuerpo_afectadas: ['manos', 'miembros_superiores'],
  gravedad: 'grave',
  dias_baja_estimados: 15,
  testigos_presentes: true,
  descripcion_inicial:
    'Durante la operación de la prensa, el operario sufrió un golpe en la mano derecha al retirar la pieza.',
};

const minimalFixture: AccidenteMetadata = {
  razon_social: 'Almacenes del Centro SA',
  cuit: '30-22334455-6',
  domicilio: 'Calle Comercio 100',
  fecha_accidente: '2026-04-20',
  hora_accidente: '09:15',
  lugar_especifico: 'Depósito',
  puesto_afectado: 'Repositor',
  tipo_lesion: ['contusion'],
  partes_cuerpo_afectadas: ['miembros_inferiores'],
  gravedad: 'leve',
  testigos_presentes: false,
  descripcion_inicial: 'Caída al mismo nivel por piso mojado en pasillo del depósito.',
};

describe('AccidenteMetadataSummaryContent', () => {
  it('renderiza h2, badge "Datos completos" y todos los campos con full', () => {
    render(<AccidenteMetadataSummaryContent metadata={fullFixture} />);

    expect(screen.getByText('Datos del incidente')).toBeInTheDocument();
    expect(screen.getByText('Datos completos')).toBeInTheDocument();
    expect(screen.getByText(fullFixture.razon_social)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.cuit)).toBeInTheDocument();
    expect(screen.getByText('18/04/2026 14:30')).toBeInTheDocument();
    expect(screen.getByText(fullFixture.lugar_especifico)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.puesto_afectado)).toBeInTheDocument();
    expect(screen.getByText('Grave (baja prolongada)')).toBeInTheDocument();
    expect(screen.getByText('Contusión, Esguince / distensión')).toBeInTheDocument();
    expect(screen.getByText('Manos, Miembros superiores')).toBeInTheDocument();
    expect(screen.getByText('Sí')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText(fullFixture.descripcion_inicial)).toBeInTheDocument();
  });

  it('omite dias_baja_estimados y marca "Datos parciales" con minimal', () => {
    render(<AccidenteMetadataSummaryContent metadata={minimalFixture} />);

    expect(screen.getByText('Datos parciales')).toBeInTheDocument();
    expect(screen.queryByText('Días de baja estimados')).not.toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('Leve (sin baja prolongada)')).toBeInTheDocument();
    expect(screen.getByText(minimalFixture.descripcion_inicial)).toBeInTheDocument();
  });
});
