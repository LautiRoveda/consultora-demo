'use client';

import type { UseFormReturn } from 'react-hook-form';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form';
import { Textarea } from '@/shared/ui/textarea';

import { INSTRUCCIONES_ADICIONALES_MAX } from './campos-extra';

/**
 * T-138 fase 1 · Instruccion libre de estilo/foco persistida con la metadata.
 *
 * Distinto de las "Notas adicionales" del paso de generacion (userPrompt):
 * esto acompana al informe en cada regeneracion; las notas son por corrida.
 * El copy lo deja claro y marca la jerarquia (preferencia, no regla).
 *
 * Patron ''-friendly de `equipos_medicion`: onChange convierte '' → undefined
 * para que `.optional()` matchee sin transforms en el schema.
 */
type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  disabled?: boolean;
};

export function InstruccionesAdicionalesField({ form, disabled }: Props) {
  // Asserts puntuales: el form viene como UseFormReturn<any> (ver Props) y el
  // shape real lo garantiza Zod (instruccionesAdicionalesField en cada schema).
  const watched = (form.watch('instrucciones_adicionales') ?? '') as string;

  return (
    <FormField
      control={form.control}
      name="instrucciones_adicionales"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Instrucciones adicionales (opcional)</FormLabel>
          <FormControl>
            <Textarea
              rows={3}
              maxLength={INSTRUCCIONES_ADICIONALES_MAX}
              placeholder="Ej: priorizá las recomendaciones de bajo costo y redactá las conclusiones para un lector no técnico."
              disabled={disabled}
              {...field}
              value={(field.value ?? '') as string}
              onChange={(e) => field.onChange(e.target.value || undefined)}
            />
          </FormControl>
          <FormDescription>
            Preferencias de estilo o foco para el borrador. No reemplazan las reglas del sistema
            (datos sin inventar, placeholders, revisión del matriculado).
          </FormDescription>
          <p className="text-muted-foreground text-xs">
            {watched.length} / {INSTRUCCIONES_ADICIONALES_MAX} caracteres
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
