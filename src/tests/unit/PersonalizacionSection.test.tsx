/**
 * T-138 fase 1 · Tests de la seccion "Personalizacion del informe" compartida
 * (CamposPersonalizadosFields + InstruccionesAdicionalesField + colapso).
 *
 * Harness: RHF + zodResolver con un schema minimo de solo los campos de
 * personalizacion — el comportamiento no depende del tipo de informe.
 */
import type { FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  camposPersonalizadosField,
  instruccionesAdicionalesField,
} from '@/shared/templates/common/campos-extra';
import { PersonalizacionSection } from '@/shared/templates/common/PersonalizacionSection';
import { Form } from '@/shared/ui/form';

const schema = z.object({
  campos_personalizados: camposPersonalizadosField(),
  instrucciones_adicionales: instruccionesAdicionalesField(),
});

function Harness({ defaults, disabled }: { defaults?: FieldValues; disabled?: boolean }) {
  const form = useForm<FieldValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults ?? { campos_personalizados: [], instrucciones_adicionales: '' },
  });
  return (
    <Form {...form}>
      <PersonalizacionSection form={form} disabled={disabled} />
    </Form>
  );
}

afterEach(() => cleanup());

describe('PersonalizacionSection', () => {
  it('arranca colapsada sin personalizacion previa (config avanzada, no alarga el wizard)', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Mostrar personalización')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agregar campo/ })).not.toBeInTheDocument();
  });

  it('arranca abierta si la metadata ya trae personalizacion (editar no esconde datos)', () => {
    render(
      <Harness
        defaults={{
          campos_personalizados: [{ label: 'N° de expediente', valor: 'EXP-001' }],
          instrucciones_adicionales: '',
        }}
      />,
    );
    expect(screen.getByLabelText('Ocultar personalización')).toBeInTheDocument();
    expect(screen.getByDisplayValue('EXP-001')).toBeInTheDocument();
  });

  it('agrega y quita filas de campos personalizados', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Mostrar personalización'));

    fireEvent.click(screen.getByRole('button', { name: /Agregar campo/ }));
    const labelInput = screen.getByPlaceholderText('Etiqueta (ej: N° de expediente)');
    fireEvent.change(labelInput, { target: { value: 'Norma interna' } });
    expect(screen.getByDisplayValue('Norma interna')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Quitar campo 1'));
    expect(screen.queryByDisplayValue('Norma interna')).not.toBeInTheDocument();
  });

  it('cap de 10 campos: boton Agregar disabled + contador', () => {
    render(
      <Harness
        defaults={{
          campos_personalizados: Array.from({ length: 10 }, (_, i) => ({
            label: `Campo ${i + 1}`,
            valor: 'v',
          })),
          instrucciones_adicionales: '',
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /Agregar campo/ })).toBeDisabled();
    expect(screen.getByText('10 / 10 campos')).toBeInTheDocument();
  });

  it('instrucciones: contador de caracteres en vivo', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Mostrar personalización'));

    const textarea = screen.getByLabelText('Instrucciones adicionales (opcional)');
    fireEvent.change(textarea, { target: { value: 'foco en EPP' } });
    expect(screen.getByText('11 / 1500 caracteres')).toBeInTheDocument();
  });

  it('disabled deshabilita inputs y botones', () => {
    render(
      <Harness
        defaults={{
          campos_personalizados: [{ label: 'L', valor: 'v' }],
          instrucciones_adicionales: '',
        }}
        disabled
      />,
    );
    expect(screen.getByDisplayValue('L')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Agregar campo/ })).toBeDisabled();
    expect(screen.getByLabelText('Quitar campo 1')).toBeDisabled();
    expect(screen.getByLabelText('Instrucciones adicionales (opcional)')).toBeDisabled();
  });
});
