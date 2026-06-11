'use client';

/**
 * T-140 · Bridge Plate ↔ RHF para el contenido del informe.
 *
 * El source of truth sigue siendo **markdown string** (RHF `content`). Este
 * componente NO guarda nodos Plate en el form: deserializa markdown a Plate al
 * cargar y serializa Plate a markdown al editar.
 *
 * Dos caminos one-way (sin heurística "¿fui yo?"):
 *  - EXTERNO (mount + cada bump de `resetSignal`, p.ej. el volcado del stream al
 *    `done`): deserializa el `value` ACTUAL. `isResetting` suprime el onChange
 *    que dispara `setValue` → NO marca dirty ni muta el content al cargar.
 *    (Refuerzo: baseline `lastSerialized` para que el guard anti-no-op también
 *    descarte el onChange del reset aunque el flag se libere antes.)
 *  - TIPEO: onChange (debounced) → serialize → onChange(md), con guard anti-no-op.
 *
 * Flush: `onRegisterFlush` expone el serialize al padre para forzarlo en submit
 * (no confiar en el valor debounced → evita stale-save). También flush en blur.
 */
import { MarkdownPlugin } from '@platejs/markdown';
import { Plate, usePlateEditor } from 'platejs/react';
import * as React from 'react';

import { Editor, EditorContainer } from './editor';
import { FixedToolbar } from './fixed-toolbar';
import { REPORT_EDITOR_PLUGINS } from './report-plugins';

const DEBOUNCE_MS = 200;

type ReportMarkdownEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  /** Cambiar este número fuerza un re-deserialize del `value` actual (mount + done + source-mode). */
  resetSignal: number;
  disabled?: boolean;
  /** El padre guarda el flush y lo llama en submit para serializar lo último tecleado. */
  onRegisterFlush?: (flush: () => string) => void;
};

export function ReportMarkdownEditor({
  value,
  onChange,
  onBlur,
  resetSignal,
  disabled,
  onRegisterFlush,
}: ReportMarkdownEditorProps) {
  const editor = usePlateEditor({ plugins: REPORT_EDITOR_PLUGINS });

  const valueRef = React.useRef(value);
  // Sync del último value via effect (no en render: react-hooks/refs). Declarado
  // antes del effect de reset → corre primero y deja valueRef fresco para él.
  React.useEffect(() => {
    valueRef.current = value;
  });
  const isResetting = React.useRef(false);
  const lastSerialized = React.useRef(value);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const serialize = React.useCallback(
    () => editor.getApi(MarkdownPlugin).markdown.serialize(),
    [editor],
  );

  // Camino EXTERNO: deserializa el value actual en mount y en cada bump de resetSignal.
  React.useEffect(() => {
    isResetting.current = true;
    editor.tf.setValue(editor.getApi(MarkdownPlugin).markdown.deserialize(valueRef.current));
    // Baseline = forma serializada (tight) de lo recién cargado → el onChange del
    // setValue da md === baseline y el guard lo descarta aunque el flag ya se haya liberado.
    lastSerialized.current = serialize();
    const id = setTimeout(() => {
      isResetting.current = false;
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  React.useEffect(() => {
    onRegisterFlush?.(serialize);
  }, [onRegisterFlush, serialize]);

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = React.useCallback(() => {
    if (isResetting.current) return; // ignora el onChange del reset/deserialize
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const markdown = serialize();
      if (markdown === lastSerialized.current) return; // guard anti-no-op (cursor, re-render)
      lastSerialized.current = markdown;
      onChange(markdown);
    }, DEBOUNCE_MS);
  }, [onChange, serialize]);

  return (
    <Plate editor={editor} onChange={handleChange} readOnly={disabled}>
      {/* Toolbar fija dentro de <Plate> (usa el contexto del editor). El editor
          va abajo con la esquina superior cuadrada para coser el borde. */}
      <FixedToolbar />
      <EditorContainer>
        <Editor
          variant="none"
          onBlur={onBlur}
          placeholder="Generá el borrador con IA o escribí el informe…"
          className="min-h-[60vh] rounded-b-md border px-4 py-3 sm:min-h-[600px]"
        />
      </EditorContainer>
    </Plate>
  );
}
