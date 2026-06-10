'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '@/shared/ui/button';

interface Props {
  index: number;
  total: number;
  /** Etiqueta del elemento para los aria-label (ej: «Generalidades»). */
  label: string;
  onMove: (direction: 'up' | 'down') => void;
  disabled?: boolean;
}

/**
 * Botones ↑/↓ accesibles para reordenar (sin drag&drop). Disabled en los extremos
 * (también requisito WCAG: evita un control que no hace nada). El padre computa el
 * reorden (array completo a una action two-phase en checklists; useFieldArray.move
 * en la config de secciones de templates).
 *
 * T-138 · Hoisteado desde checklists/[id]/ReorderButtons.tsx: templates (shared)
 * no puede importar de un módulo de app. `size="none"` + clase manual evita el
 * leak de `md:pointer-fine:*` de tailwind-merge (gotcha T-127).
 */
export function ReorderButtons({ index, total, label, onMove, disabled = false }: Props) {
  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <div className="flex flex-col">
      <Button
        type="button"
        variant="ghost"
        size="none"
        className="size-7"
        disabled={disabled || isFirst}
        aria-label={`Subir «${label}»`}
        onClick={() => onMove('up')}
      >
        <ChevronUp className="size-4" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="none"
        className="size-7"
        disabled={disabled || isLast}
        aria-label={`Bajar «${label}»`}
        onClick={() => onMove('down')}
      >
        <ChevronDown className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
