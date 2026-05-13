import type { OtrosMetadata } from '@/shared/templates/otros/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OtrosMetadataSummaryContent } from '@/shared/templates/otros/OtrosMetadataSummaryContent';

afterEach(() => {
  cleanup();
});

const fullFixture: OtrosMetadata = {
  razon_social: 'Estudio Jurídico Pérez & Asoc.',
  cuit: '30-66778899-0',
  tema_informe: 'Auditoría de cumplimiento normativo SRT Q1 2026',
  objetivos: 'Verificar vigencias de capacitaciones, entrega de EPP y libro de incidentes.',
};

const minimalFixture: OtrosMetadata = {
  razon_social: 'Cooperativa El Trébol',
  cuit: '30-88990011-2',
  tema_informe: 'Nota técnica sobre uso de pictogramas en obrador',
};

describe('OtrosMetadataSummaryContent', () => {
  it('renderiza h2, badge "Datos completos" y objetivos con full', () => {
    render(<OtrosMetadataSummaryContent metadata={fullFixture} />);

    expect(screen.getByText('Datos del informe')).toBeInTheDocument();
    expect(screen.getByText('Datos completos')).toBeInTheDocument();
    expect(screen.getByText(fullFixture.razon_social)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.cuit)).toBeInTheDocument();
    expect(screen.getByText(fullFixture.tema_informe)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Verificar vigencias de capacitaciones, entrega de EPP y libro de incidentes.',
      ),
    ).toBeInTheDocument();
  });

  it('omite objetivos y marca "Datos parciales" con minimal', () => {
    render(<OtrosMetadataSummaryContent metadata={minimalFixture} />);

    expect(screen.getByText('Datos parciales')).toBeInTheDocument();
    expect(screen.queryByText('Objetivos / contexto')).not.toBeInTheDocument();
    expect(screen.getByText(minimalFixture.razon_social)).toBeInTheDocument();
    expect(screen.getByText(minimalFixture.tema_informe)).toBeInTheDocument();
  });
});
