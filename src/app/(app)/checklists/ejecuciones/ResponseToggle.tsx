'use client';

import { cn } from '@/shared/lib/utils';

export type ToggleTone = 'ok' | 'bad' | 'na' | 'neutral';
export type ToggleOption = { value: string; label: string; tone: ToggleTone };

export type ResponseToggleProps = {
  /** Único por ítem (agrupa los radios nativos). */
  name: string;
  ariaLabel: string;
  options: ToggleOption[];
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * T-061a · Toggle grande SI/NO/N-A (o Sí/No) hand-rolled — shadcn no trae
 * ToggleGroup. Usa radios nativos (sr-only) para teclado + semántica radiogroup
 * gratis; el `<label>` es el target táctil (≥44px, `min-h-11`). Tonos consistentes
 * con `responseClass` del print (si=verde, no=rojo, na=muted).
 */
function toneClass(tone: ToggleTone, selected: boolean): string {
  if (!selected) return 'border-input bg-background hover:bg-muted/50';
  switch (tone) {
    case 'ok':
      return 'border-emerald-600 bg-emerald-600 text-white';
    case 'bad':
      return 'border-red-600 bg-red-600 text-white';
    case 'na':
      return 'border-muted-foreground/40 bg-muted text-foreground';
    default:
      return 'border-primary bg-primary text-primary-foreground';
  }
}

export function ResponseToggle({
  name,
  ariaLabel,
  options,
  value,
  onChange,
  disabled,
}: ResponseToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            className={cn(
              'focus-within:ring-ring flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-offset-1',
              toneClass(opt.tone, selected),
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}
