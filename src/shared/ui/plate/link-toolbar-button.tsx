'use client';

/**
 * T-141 · Botón de enlace. En vez de montar todo el subsistema floating-link de
 * Plate (overlay + varios componentes), un popover propio mínimo: pide la URL y
 * aplica con el helper estático `upsertLink` sobre la selección viva (Slate
 * conserva `editor.selection` aunque el foco DOM pase al input). Quirúrgico.
 */
import { upsertLink } from '@platejs/link';
import { Link as LinkIcon } from 'lucide-react';
import { useEditorReadOnly, useEditorRef } from 'platejs/react';
import * as React from 'react';

import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';

import { ToolbarButton } from './toolbar';

export function LinkToolbarButton() {
  const editor = useEditorRef();
  const readOnly = useEditorReadOnly();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState('');

  function apply() {
    const trimmed = url.trim();
    if (!trimmed) return;
    // upsertLink valida/normaliza la URL internamente; con selección colapsada
    // inserta el texto+link, con selección expandida envuelve lo seleccionado.
    upsertLink(editor, { url: trimmed });
    setUrl('');
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolbarButton label="Enlace" disabled={readOnly} onMouseDown={(e) => e.preventDefault()}>
          <LinkIcon />
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
          className="flex items-center gap-2"
        >
          <Input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            aria-label="URL del enlace"
            inputMode="url"
          />
          <Button type="submit" size="sm" disabled={!url.trim()}>
            Aplicar
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
