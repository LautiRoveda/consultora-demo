/**
 * T-139 · PlantillaControls: aplicar plantilla al form (helper puro — la
 * interaccion con el Select de Radix no suma sobre jsdom) + dialog de guardado
 * (validacion de nombre client-side antes de tocar la action).
 */
import type { FieldValues } from 'react-hook-form';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPlantillaAction } from '@/app/(app)/informes/plantillas/actions';
import {
  aplicarPlantillaAlForm,
  PlantillaControls,
} from '@/app/(app)/informes/plantillas/PlantillaControls';
import { defaultSeccionesConfig } from '@/shared/templates/common/secciones';
import { SECCION_IDS_RELEVAMIENTO } from '@/shared/templates/relevamiento/secciones';

// La action importa next/cache + supabase server (incompatibles con jsdom) y
// el componente usa useRouter — ambos mockeados.
vi.mock('@/app/(app)/informes/plantillas/actions', () => ({
  createPlantillaAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function buildForm() {
  const { result } = renderHook(() =>
    useForm<FieldValues>({
      defaultValues: {
        campos_personalizados: [],
        instrucciones_adicionales: '',
        secciones: defaultSeccionesConfig(SECCION_IDS_RELEVAMIENTO),
      },
    }),
  );
  return result.current;
}

afterEach(() => cleanup());

describe('aplicarPlantillaAlForm', () => {
  it('popula los 3 campos de personalizacion con la config de la plantilla', () => {
    const form = buildForm();
    const result = aplicarPlantillaAlForm(
      'relevamiento',
      {
        campos_personalizados: [{ label: 'Expediente', valor: 'EXP-1' }],
        instrucciones_adicionales: 'Tono formal.',
        secciones: [{ kind: 'catalogo', seccion_id: 'mediciones' }],
      },
      form,
    );
    expect(result).toMatchObject({ ok: true, degradado: false });
    expect(form.getValues('campos_personalizados')).toEqual([
      { label: 'Expediente', valor: 'EXP-1' },
    ]);
    expect(form.getValues('instrucciones_adicionales')).toBe('Tono formal.');
    expect(form.getValues('secciones')).toEqual([{ kind: 'catalogo', seccion_id: 'mediciones' }]);
  });

  it('plantilla sin secciones resetea la estructura al default del catalogo', () => {
    const form = buildForm();
    form.setValue('secciones', [{ kind: 'catalogo', seccion_id: 'anexos' }]);

    const result = aplicarPlantillaAlForm(
      'relevamiento',
      { instrucciones_adicionales: 'Solo instrucciones.' },
      form,
    );
    expect(result.ok).toBe(true);
    expect(form.getValues('secciones')).toEqual(defaultSeccionesConfig(SECCION_IDS_RELEVAMIENTO));
  });

  it('plantilla vieja degrada (filtra ids fuera del catalogo) y avisa', () => {
    const form = buildForm();
    const result = aplicarPlantillaAlForm(
      'relevamiento',
      {
        instrucciones_adicionales: 'Tono formal.',
        secciones: [
          { kind: 'catalogo', seccion_id: 'seccion_eliminada' },
          { kind: 'catalogo', seccion_id: 'mediciones' },
        ],
      },
      form,
    );
    expect(result).toMatchObject({ ok: true, degradado: true });
    expect(form.getValues('secciones')).toEqual([{ kind: 'catalogo', seccion_id: 'mediciones' }]);
  });

  it('config insalvable no toca el form', () => {
    const form = buildForm();
    const result = aplicarPlantillaAlForm('relevamiento', 'no-es-config', form);
    expect(result.ok).toBe(false);
    expect(form.getValues('secciones')).toEqual(defaultSeccionesConfig(SECCION_IDS_RELEVAMIENTO));
    expect(form.getValues('instrucciones_adicionales')).toBe('');
  });
});

describe('PlantillaControls (render)', () => {
  function Harness({
    plantillas,
  }: {
    plantillas: Parameters<typeof PlantillaControls>[0]['plantillas'];
  }) {
    const form = useForm<FieldValues>({
      defaultValues: {
        campos_personalizados: [],
        instrucciones_adicionales: 'Algo personalizado.',
        secciones: defaultSeccionesConfig(SECCION_IDS_RELEVAMIENTO),
      },
    });
    return <PlantillaControls tipo="relevamiento" form={form} plantillas={plantillas} />;
  }

  it('sin plantillas del tipo: muestra empty state y NO el selector', () => {
    render(<Harness plantillas={[]} />);
    expect(screen.getByText('Sin plantillas guardadas para este tipo.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Aplicar plantilla')).not.toBeInTheDocument();
  });

  it('con plantillas: muestra el selector de aplicar', () => {
    render(
      <Harness
        plantillas={[{ id: 'p1', tipo: 'relevamiento', nombre: 'Mi preset', config: {} }]}
      />,
    );
    expect(screen.getByLabelText('Aplicar plantilla')).toBeInTheDocument();
  });

  it('guardar con nombre vacio: error inline y la action NO se llama', () => {
    render(<Harness plantillas={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Guardar como plantilla/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar plantilla' }));

    expect(screen.getByText('Poné un nombre para la plantilla.')).toBeInTheDocument();
    expect(createPlantillaAction).not.toHaveBeenCalled();
  });
});
