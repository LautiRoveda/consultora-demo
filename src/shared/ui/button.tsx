import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // T-127 Tanda 1 · Touch-first: 44px (h-11/size-11) por defecto; compacta a la
        // densidad de escritorio SOLO en pantalla ancha (md) Y puntero fino (mouse),
        // via `md:pointer-fine:`. Así una tablet táctil a >=md sigue en 44px (su puntero
        // es coarse) y el default falla del lado accesible. En táctil default/sm/lg
        // colapsan a 44px de alto (difieren en padding/fuente) — es el resultado buscado.
        default: 'h-11 px-4 py-2 has-[>svg]:px-3 md:pointer-fine:h-9',
        sm: 'h-11 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5 md:pointer-fine:h-8',
        lg: 'h-11 rounded-md px-6 has-[>svg]:px-4 md:pointer-fine:h-10',
        icon: 'size-11 md:pointer-fine:size-9',
        'icon-sm': 'size-11 md:pointer-fine:size-8',
        'icon-lg': 'size-11 md:pointer-fine:size-10',
        // xs / icon-xs NO crecen: uso INLINE (dentro de badge/chip/celda) donde el target
        // real lo da el contenedor. No usar como botón suelto.
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        // Sin dimensiones inyectadas: el caller controla todo via className. Necesario
        // donde un override plano de tamaño dejaría "filtrar" el `md:pointer-fine:*` del
        // variant (tailwind-merge no dedupea entre modifiers) y reaparecer en desktop.
        none: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
