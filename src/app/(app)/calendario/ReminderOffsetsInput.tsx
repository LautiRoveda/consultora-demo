'use client';

import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';

import { OFFSET_DAYS_MAX, OFFSET_DAYS_MIN, REMINDER_OFFSETS_MAX_COUNT } from './defaults';

/**
 * T-029 · Input de chips para `reminder_offsets_days`.
 *
 * Comportamiento:
 *  - Mantiene la lista ordenada descendentemente al persistir (60, 30, 7, 0)
 *    porque asi se lee mejor: "primero el aviso mas anticipado".
 *  - Add: input numerico + click "+" o Enter. Valida min/max + duplicados.
 *  - Remove: click "X" en cada chip.
 *  - Cap REMINDER_OFFSETS_MAX_COUNT (6): input se disabled cuando se alcanza.
 *  - El parent es el dueño del valor (controlled). Re-render externo (ej:
 *    prepop al cambiar tipo) refleja inmediato.
 */

type Props = {
  value: number[];
  onChange: (next: number[]) => void;
  /** Cuando cambia, el componente prepop con los nuevos defaults SI dirty=false. */
  defaultsForCurrentTipo?: ReadonlyArray<number>;
  /** Marcar dirty cuando el user toco manualmente; si no, prepop por tipo gana. */
  dirty?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
};

export function ReminderOffsetsInput({
  value,
  onChange,
  defaultsForCurrentTipo,
  dirty = false,
  onDirtyChange,
  disabled = false,
  id,
  ariaLabel = 'Recordatorios en días antes del vencimiento',
}: Props) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-prepop al cambiar tipo (defaults nuevos llegan por prop) SI el user
  // no edito manualmente. Si dirty=true, respetamos su input.
  const lastDefaultsRef = useRef<ReadonlyArray<number> | undefined>(defaultsForCurrentTipo);
  useEffect(() => {
    if (!defaultsForCurrentTipo) return;
    if (defaultsForCurrentTipo === lastDefaultsRef.current) return;
    lastDefaultsRef.current = defaultsForCurrentTipo;
    if (!dirty) {
      onChange([...defaultsForCurrentTipo]);
    }
  }, [defaultsForCurrentTipo, dirty, onChange]);

  function tryAdd() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < OFFSET_DAYS_MIN || parsed > OFFSET_DAYS_MAX) {
      toast.error('Valor inválido', {
        description: `Ingresá un entero entre ${OFFSET_DAYS_MIN} y ${OFFSET_DAYS_MAX}.`,
      });
      return;
    }
    if (value.includes(parsed)) {
      toast.warning('Recordatorio duplicado', {
        description: `${parsed} días ya está en la lista.`,
      });
      return;
    }
    if (value.length >= REMINDER_OFFSETS_MAX_COUNT) {
      toast.warning('Límite alcanzado', {
        description: `Máximo ${REMINDER_OFFSETS_MAX_COUNT} recordatorios.`,
      });
      return;
    }
    // Insertar manteniendo orden descendente.
    const next = [...value, parsed].sort((a, b) => b - a);
    onChange(next);
    onDirtyChange?.(true);
    setDraft('');
    inputRef.current?.focus();
  }

  function remove(offset: number) {
    onChange(value.filter((v) => v !== offset));
    onDirtyChange?.(true);
  }

  const atCap = value.length >= REMINDER_OFFSETS_MAX_COUNT;

  return (
    <div className="space-y-2" id={id} aria-label={ariaLabel}>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((offset) => (
          <Badge
            key={offset}
            variant="secondary"
            className="gap-1 py-1 pl-2.5 pr-1 text-xs font-normal"
          >
            <span data-testid={`reminder-chip-${offset}`}>
              {offset === 0 ? 'El día' : `${offset}d antes`}
            </span>
            {!disabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(offset)}
                className="h-4 w-4 hover:bg-transparent"
                aria-label={`Quitar recordatorio ${offset} días`}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </Badge>
        ))}
        {value.length === 0 && (
          <p className="text-muted-foreground text-xs italic">Sin recordatorios.</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          type="number"
          min={OFFSET_DAYS_MIN}
          max={OFFSET_DAYS_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              tryAdd();
            }
          }}
          placeholder="Días"
          disabled={disabled || atCap}
          className="h-8 w-24 text-sm"
          aria-label="Días antes del vencimiento"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={tryAdd}
          disabled={disabled || atCap || draft.trim().length === 0}
          aria-label="Agregar recordatorio"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Agregar
        </Button>
        {atCap && (
          <span className="text-muted-foreground text-xs">
            {REMINDER_OFFSETS_MAX_COUNT} / {REMINDER_OFFSETS_MAX_COUNT}
          </span>
        )}
      </div>
    </div>
  );
}
