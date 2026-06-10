/**
 * T-138 fase 2 · Tests del configurador de secciones (seleccion + reorden +
 * customs). Config client-side pura via useFieldArray — sin RPC.
 *
 * Harness: RHF + zodResolver con un catalogo chico de 3 secciones (el
 * comportamiento no depende del tipo de informe).
 */
import type { SeccionConfig } from '@/shared/templates/common/secciones';
import type { FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defaultSeccionesConfig, seccionesField } from '@/shared/templates/common/secciones';
import { SeccionesConfigField } from '@/shared/templates/common/SeccionesConfigField';
import { Form } from '@/shared/ui/form';

const IDS = ['objeto', 'alcance', 'desarrollo'] as const;
const CATALOGO = [
  { id: 'objeto', label: 'Objeto del informe' },
  { id: 'alcance', label: 'Alcance' },
  { id: 'desarrollo', label: 'Desarrollo' },
] as const;

const schema = z.object({ secciones: seccionesField(IDS) });

function Harness({ defaults, disabled }: { defaults?: SeccionConfig[]; disabled?: boolean }) {
  const form = useForm<FieldValues>({
    resolver: zodResolver(schema),
    defaultValues: { secciones: defaults ?? defaultSeccionesConfig(IDS) },
  });
  return (
    <Form {...form}>
      <SeccionesConfigField form={form} catalogo={CATALOGO} disabled={disabled} />
    </Form>
  );
}

function rowLabels(): string[] {
  return screen.getAllByRole('listitem').map((li) => {
    // Primer span con el label (el resto son botones con aria-label propio).
    return li.querySelector('span.flex-1, span.min-w-0')?.textContent ?? '';
  });
}

afterEach(() => cleanup());

describe('SeccionesConfigField', () => {
  it('default: filas en orden canonico, contador, Restaurar disabled', () => {
    render(<Harness />);
    expect(rowLabels()).toEqual(['Objeto del informe', 'Alcance', 'Desarrollo']);
    expect(screen.getByText('3 / 15 secciones · personalizadas 0 / 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restaurar estructura estándar' })).toBeDisabled();
    // Extremos del reorden disabled (WCAG).
    expect(screen.getByLabelText('Subir «Objeto del informe»')).toBeDisabled();
    expect(screen.getByLabelText('Bajar «Desarrollo»')).toBeDisabled();
  });

  it('reordena con ↑/↓ via useFieldArray.move', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Bajar «Objeto del informe»'));
    expect(rowLabels()).toEqual(['Alcance', 'Objeto del informe', 'Desarrollo']);

    fireEvent.click(screen.getByLabelText('Subir «Desarrollo»'));
    expect(rowLabels()).toEqual(['Alcance', 'Desarrollo', 'Objeto del informe']);
  });

  it('quitar una seccion la ofrece como disponible; la ultima no se puede quitar (min 1)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Quitar sección «Alcance»'));
    expect(rowLabels()).toEqual(['Objeto del informe', 'Desarrollo']);
    // Reaparece como boton para re-agregar.
    expect(screen.getByRole('button', { name: 'Alcance' })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Quitar sección «Desarrollo»'));
    expect(rowLabels()).toEqual(['Objeto del informe']);
    expect(screen.getByLabelText('Quitar sección «Objeto del informe»')).toBeDisabled();
  });

  it('agrega seccion custom con titulo + descripcion; el boton exige titulo >= 3 chars', () => {
    render(<Harness />);
    const agregarBtn = screen.getByRole('button', { name: /Agregar sección$/ });
    expect(agregarBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Título de la sección personalizada'), {
      target: { value: 'Plan de izaje' },
    });
    fireEvent.change(screen.getByLabelText('Descripción de la sección personalizada'), {
      target: { value: 'Secuencia y señalero' },
    });
    expect(agregarBtn).toBeEnabled();
    fireEvent.click(agregarBtn);

    expect(rowLabels()).toEqual(['Objeto del informe', 'Alcance', 'Desarrollo', 'Plan de izaje']);
    expect(screen.getByText('personalizada')).toBeInTheDocument();
    expect(screen.getByText('4 / 15 secciones · personalizadas 1 / 5')).toBeInTheDocument();
    // Inputs limpios tras agregar.
    expect(screen.getByLabelText('Título de la sección personalizada')).toHaveValue('');
  });

  it('restaurar estructura estandar repone el orden canonico completo', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Quitar sección «Alcance»'));
    fireEvent.click(screen.getByLabelText('Bajar «Objeto del informe»'));
    expect(rowLabels()).toEqual(['Desarrollo', 'Objeto del informe']);

    fireEvent.click(screen.getByRole('button', { name: 'Restaurar estructura estándar' }));
    expect(rowLabels()).toEqual(['Objeto del informe', 'Alcance', 'Desarrollo']);
  });

  it('disabled deshabilita reorden, quitar, agregar y restaurar', () => {
    render(
      <Harness
        defaults={[
          { kind: 'catalogo', seccion_id: 'objeto' },
          { kind: 'custom', titulo: 'Plan de izaje' },
        ]}
        disabled
      />,
    );
    expect(screen.getByLabelText('Bajar «Objeto del informe»')).toBeDisabled();
    expect(screen.getByLabelText('Quitar sección «Plan de izaje»')).toBeDisabled();
    expect(screen.getByLabelText('Título de la sección personalizada')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restaurar estructura estándar' })).toBeDisabled();
    // Botones de catalogo disponibles tambien disabled.
    expect(screen.getByRole('button', { name: 'Alcance' })).toBeDisabled();
  });
});
