'use client';

/**
 * T-029 · Convencion de imports Radix en este repo.
 *
 * shadcn por default instala paquetes Radix separados (@radix-ui/react-popover,
 * @radix-ui/react-tabs, etc.). Este repo usa el paquete unificado `radix-ui`
 * (ver `package.json:radix-ui ^1.4.3` y `src/shared/ui/sheet.tsx:4`). Cuando
 * agregamos componentes con `pnpm dlx shadcn@latest add ...`, el CLI ya respeta
 * este patron en versiones recientes — pero si en el futuro shadcn introduce
 * imports tipo `import * as PopoverPrimitive from '@radix-ui/react-popover'`,
 * hay que reescribir a `import { Popover as PopoverPrimitive } from 'radix-ui'`
 * y NO sumar el paquete separado a `package.json` (evita duplicacion de Radix
 * en el bundle + mismatch potencial de versiones de Portal).
 */
import { Popover as PopoverPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn('flex flex-col gap-1 text-sm', className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <div data-slot="popover-title" className={cn('font-medium', className)} {...props} />;
}

function PopoverDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="popover-description"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
};
