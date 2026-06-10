'use client';

import type { UseFormReturn } from 'react-hook-form';
import type { OtrosMetadata } from './schema';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Separator } from '@/shared/ui/separator';
import { Textarea } from '@/shared/ui/textarea';

import { normalizeCuit } from '../common/cuit';
import { PersonalizacionSection } from '../common/PersonalizacionSection';

/**
 * T-022 · Form "Otros" (tipo wildcard). Form minimal: 4 fields.
 *
 * Decision Q11.a: minimal form (no no-form). Sin domicilio — el tipo wildcard
 * puede no aplicar a sitio fisico.
 *
 * Secciones:
 *  - Cliente (2 fields: razon_social + cuit).
 *  - Informe (tema + objetivos opcional).
 */

const OBJETIVOS_MAX = 2000;

export const otrosMetadataDefaults = (): OtrosMetadata => ({
  razon_social: '',
  cuit: '',
  tema_informe: '',
  objetivos: '',
  campos_personalizados: [],
  instrucciones_adicionales: '',
});

type Props = {
  form: UseFormReturn<OtrosMetadata>;
  disabled?: boolean;
};

export function OtrosMetadataForm({ form, disabled }: Props) {
  const watchedObjetivos = form.watch('objetivos') ?? '';

  return (
    <div className="space-y-6">
      {/* ===================================================================
            CLIENTE
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Cliente
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="razon_social"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Razón social</FormLabel>
                <FormControl>
                  <Input placeholder="Ej: Inmobiliaria Pampa SRL" disabled={disabled} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="cuit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>CUIT</FormLabel>
                <FormControl>
                  <Input
                    placeholder="30-12345678-9"
                    disabled={disabled}
                    {...field}
                    onBlur={(e) => {
                      const normalized = normalizeCuit(e.target.value);
                      if (normalized !== e.target.value) {
                        form.setValue('cuit', normalized, { shouldDirty: true });
                      }
                      field.onBlur();
                    }}
                  />
                </FormControl>
                <FormDescription>Con o sin guiones — se normaliza al guardar.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* ===================================================================
            INFORME
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Informe
        </h3>
        <FormField
          control={form.control}
          name="tema_informe"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tema del informe</FormLabel>
              <FormControl>
                <Input
                  placeholder="Ej: Auditoría interna ISO 45001"
                  disabled={disabled}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Una frase corta que orienta a la IA sobre el alcance del informe.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="objetivos"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Objetivos / contexto adicional (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={5}
                  maxLength={OBJETIVOS_MAX}
                  placeholder="Ej: Verificar cumplimiento de la norma. Revisión de matriz de riesgos, jerarquía de controles y formación del personal."
                  disabled={disabled}
                  {...field}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value || undefined)}
                />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                {watchedObjetivos.length} / {OBJETIVOS_MAX} caracteres
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>

      {/* T-138 · Personalizacion compartida (campos + instrucciones). */}
      <PersonalizacionSection form={form} disabled={disabled} />
    </div>
  );
}
