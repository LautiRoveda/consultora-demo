'use client';

import type { ReactNode } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/shared/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { Separator } from '@/shared/ui/separator';

import { CamposPersonalizadosFields } from './CamposPersonalizadosFields';
import { InstruccionesAdicionalesField } from './InstruccionesAdicionalesField';

/**
 * T-138 fase 1 · Seccion "Personalizacion del informe" compartida por los 5
 * forms de metadata (cada XxxMetadataForm la monta al final, en una linea).
 *
 * Colapsada por default: es config avanzada y el FormComponent se reusa en el
 * wizard de alta (InformeNuevoForm) — no alarga el flujo comun. Arranca
 * abierta solo si la metadata ya trae personalizacion (editar un informe que
 * la usa no debe esconder datos).
 *
 * `children`: slot entre campos e instrucciones — fase 2 inserta ahi la
 * configuracion de secciones en los tipos sin estructura legal.
 *
 * `abrirSi`: señal extra para el estado inicial (solo primer render). Los
 * tipos fase-2 la usan para arrancar abierta cuando la estructura guardada
 * difiere del default — esta seccion no conoce el catalogo del tipo.
 */
type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  disabled?: boolean;
  children?: ReactNode;
  abrirSi?: boolean;
};

export function PersonalizacionSection({ form, disabled, children, abrirSi = false }: Props) {
  const [open, setOpen] = useState<boolean>(() => {
    // Asserts puntuales: el form viene como UseFormReturn<any> y el shape real
    // lo garantiza Zod (factories de campos-extra en cada schema).
    const campos = (form.getValues('campos_personalizados') ?? []) as unknown[];
    const instrucciones = (form.getValues('instrucciones_adicionales') ?? '') as string;
    return abrirSi || campos.length > 0 || instrucciones.length > 0;
  });

  return (
    <>
      <Separator />
      <section className="space-y-4">
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
              Personalización del informe{' '}
              <span className="font-normal normal-case">(opcional)</span>
            </h3>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={open ? 'Ocultar personalización' : 'Mostrar personalización'}
              >
                <ChevronDown
                  className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="space-y-6 pt-2">
            <CamposPersonalizadosFields form={form} disabled={disabled} />
            {children}
            <InstruccionesAdicionalesField form={form} disabled={disabled} />
          </CollapsibleContent>
        </Collapsible>
      </section>
    </>
  );
}
