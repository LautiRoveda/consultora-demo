'use client';

/**
 * T-141 · Primitivos de toolbar para el editor de informes. Montados sobre el
 * paquete unificado `radix-ui` (mismo que el resto de los primitivos del repo —
 * NO `@radix-ui/react-toolbar` suelto) → cero dep nueva y sin colisión con el
 * radix unificado. `radix-ui/Toolbar` da el roving-tabindex + rol a11y.
 *
 * `ToolbarButton` es un botón toggle: `pressed` controla `aria-pressed` +
 * `data-state` para el estilo activo. Sizing híbrido táctil (T-127): 44px en
 * coarse/mobile, compacto solo en desktop+puntero fino (`md:pointer-fine:`).
 */
import { Toolbar as ToolbarPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';

function Toolbar({ className, ...props }: React.ComponentProps<typeof ToolbarPrimitive.Root>) {
  return (
    <ToolbarPrimitive.Root
      data-slot="toolbar"
      // flex-wrap: en mobile los botones bajan de fila en vez de desbordar (lección T-127/FU1).
      className={cn('flex flex-wrap items-center gap-0.5', className)}
      {...props}
    />
  );
}

function ToolbarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ToolbarPrimitive.Separator>) {
  return (
    <ToolbarPrimitive.Separator
      data-slot="toolbar-separator"
      className={cn('mx-1 h-6 w-px shrink-0 bg-border', className)}
      {...props}
    />
  );
}

type ToolbarButtonProps = React.ComponentProps<typeof ToolbarPrimitive.Button> & {
  pressed?: boolean;
  /** Texto accesible: va a `aria-label` + `title` (tooltip nativo, sin provider). */
  label?: string;
};

function ToolbarButton({ className, pressed, label, children, ...props }: ToolbarButtonProps) {
  return (
    <ToolbarPrimitive.Button
      data-slot="toolbar-button"
      data-state={pressed ? 'on' : 'off'}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground md:pointer-fine:h-9 md:pointer-fine:min-w-9',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {children}
    </ToolbarPrimitive.Button>
  );
}

export { Toolbar, ToolbarButton, ToolbarSeparator };
