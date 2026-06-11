/**
 * T-140 · Bridge Plate↔RHF.
 *
 * (1) Requisito del owner: cargar un informe con listas "loose" → Plate las
 *     normaliza a "tight" al deserializar, pero `isResetting` + el baseline
 *     anti-no-op deben suprimir ese onChange → el form queda NOT dirty y el
 *     content intacto. El dirty real sólo aparece cuando el usuario edita.
 * (2) Smoke: los node-components mínimos renderizan tabla + lista en el editor.
 */
import type { UseFormReturn } from 'react-hook-form';
import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it } from 'vitest';

import { ReportMarkdownEditor } from '@/shared/ui/plate/report-markdown-editor';

// Lista "loose": líneas en blanco entre ítems (lo que emite Claude en recomendaciones).
const LOOSE_MD = ['# Informe', '', '1. Primero', '', '   - sub a', '', '2. Segundo', ''].join('\n');

type FormShape = { content: string };
type FormRef = React.MutableRefObject<UseFormReturn<FormShape> | null>;

function Harness({ initial, formRef }: { initial: string; formRef: FormRef }) {
  const form = useForm<FormShape>({ defaultValues: { content: initial } });
  formRef.current = form;
  // Suscribir content + isDirty para que el formState quede actualizado al leerlo.
  // eslint-disable-next-line react-hooks/incompatible-library
  const value = form.watch('content');
  void form.formState.isDirty;
  return (
    <ReportMarkdownEditor
      value={value}
      onChange={(md) => form.setValue('content', md, { shouldDirty: true })}
      resetSignal={0}
    />
  );
}

afterEach(() => cleanup());

describe('T-140 · bridge Plate↔RHF', () => {
  it('cargar markdown loose → sin editar → NOT dirty + content idéntico', async () => {
    const formRef: FormRef = { current: null };
    const { container } = render(<Harness initial={LOOSE_MD} formRef={formRef} />);

    await waitFor(() => expect(container.querySelector('[data-slate-editor]')).toBeTruthy());
    // Pasar la ventana de debounce (200ms) + margen, por si hay onChange post-reset.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(formRef.current?.formState.isDirty).toBe(false);
    expect(formRef.current?.getValues().content).toBe(LOOSE_MD);
  });

  it('renderiza tabla y lista ordenada en el editor (node-components mínimos)', async () => {
    const md = ['| A | B |', '|---|---|', '| 1 | 2 |', '', '1. uno', '2. dos', ''].join('\n');
    const formRef: FormRef = { current: null };
    const { container } = render(<Harness initial={md} formRef={formRef} />);

    await waitFor(() => expect(container.querySelector('[data-slate-editor] table')).toBeTruthy());
    const editor = container.querySelector('[data-slate-editor]')!;
    expect(editor.querySelectorAll('td').length).toBeGreaterThanOrEqual(2);
    expect(editor.querySelector('ol')).toBeTruthy(); // BlockList envuelve ordenadas en <ol>
    expect(editor.textContent).toContain('uno');
    expect(editor.textContent).toContain('dos');
  });
});
