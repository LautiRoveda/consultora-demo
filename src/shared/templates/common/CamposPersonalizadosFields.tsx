'use client';

import type { UseFormReturn } from 'react-hook-form';
import { Plus, X } from 'lucide-react';
import { useFieldArray } from 'react-hook-form';

import { Button } from '@/shared/ui/button';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';

import { CAMPO_LABEL_MAX, CAMPO_VALOR_MAX, CAMPOS_PERSONALIZADOS_MAX } from './campos-extra';

/**
 * T-138 fase 1 · Array field de pares label/valor definidos por el consultor.
 *
 * Compartido por los 5 forms de metadata via `PersonalizacionSection`. Usa
 * `useFieldArray` (primer uso en el modulo templates — `areas_relevadas` usa
 * setValue manual porque mezcla presets con texto libre; aca cada item es un
 * objeto editable con identidad propia).
 *
 * `UseFormReturn<any>`: mismo trade-off que registry/client.tsx — la
 * invarianza de UseFormReturn<T> impide tiparlo cross-tipo; la garantia de
 * shape es Zod en runtime (camposPersonalizadosField en cada schema).
 */
type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  disabled?: boolean;
};

export function CamposPersonalizadosFields({ form, disabled }: Props) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'campos_personalizados',
  });

  const atCap = fields.length >= CAMPOS_PERSONALIZADOS_MAX;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Campos personalizados</p>
        <p className="text-muted-foreground text-sm">
          Datos propios de tu trabajo que el borrador debe incluir (ej: N° de expediente, norma
          interna, referente de planta).
        </p>
      </div>

      {fields.map((field, index) => (
        <div key={field.id} className="flex items-start gap-2">
          <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-[2fr_3fr]">
            <FormField
              control={form.control}
              name={`campos_personalizados.${index}.label`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel className="sr-only">Etiqueta del campo {index + 1}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Etiqueta (ej: N° de expediente)"
                      maxLength={CAMPO_LABEL_MAX}
                      disabled={disabled}
                      {...f}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`campos_personalizados.${index}.valor`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel className="sr-only">Valor del campo {index + 1}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Valor"
                      maxLength={CAMPO_VALOR_MAX}
                      disabled={disabled}
                      {...f}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          {/* size="none" + clase manual: evita el leak de md:pointer-fine:* de
              tailwind-merge (gotcha T-127). */}
          <Button
            type="button"
            variant="ghost"
            size="none"
            className="size-9 shrink-0"
            disabled={disabled}
            aria-label={`Quitar campo ${index + 1}`}
            onClick={() => remove(index)}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || atCap}
          onClick={() => append({ label: '', valor: '' })}
        >
          <Plus className="size-4" aria-hidden />
          Agregar campo
        </Button>
        {fields.length > 0 && (
          <p className="text-muted-foreground text-xs">
            {fields.length} / {CAMPOS_PERSONALIZADOS_MAX} campos
          </p>
        )}
      </div>

      {/* Mensaje del array completo (ej: cap excedido via paste de metadata). */}
      <FormField
        control={form.control}
        name="campos_personalizados"
        render={() => (
          <FormItem>
            <FormMessage />
            {atCap && (
              <FormDescription>
                Llegaste al máximo de {CAMPOS_PERSONALIZADOS_MAX} campos.
              </FormDescription>
            )}
          </FormItem>
        )}
      />
    </div>
  );
}
