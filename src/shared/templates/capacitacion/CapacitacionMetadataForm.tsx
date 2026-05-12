'use client';

import type { UseFormReturn } from 'react-hook-form';
import type { CapacitacionMetadata } from './schema';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Separator } from '@/shared/ui/separator';
import { Textarea } from '@/shared/ui/textarea';

import { normalizeCuit } from '../common/cuit';
import { MODALIDAD_CAPACITACION } from './schema';

/**
 * T-022 · Form Capacitacion. Mismo contrato visual que `RgrlMetadataForm`:
 * grid 2 cols desktop / 1 col mobile, secciones separadas por `<Separator>`.
 *
 * Secciones:
 *  - Cliente (3 fields).
 *  - Actividad formativa (6 fields).
 *  - Contenidos (1 textarea opcional).
 */

const CONTENIDOS_MAX = 2000;
const TODAY_ISO = (): string => new Date().toISOString().slice(0, 10);

export const capacitacionMetadataDefaults = (): CapacitacionMetadata => ({
  razon_social: '',
  cuit: '',
  domicilio: '',
  fecha_capacitacion: TODAY_ISO(),
  modalidad: 'presencial',
  duracion_horas: 2,
  tema_principal: '',
  capacitador_nombre: '',
  capacitador_matricula: '',
  cantidad_asistentes_prevista: 10,
  contenidos_resumen: '',
});

type Props = {
  form: UseFormReturn<CapacitacionMetadata>;
  disabled?: boolean;
};

export function CapacitacionMetadataForm({ form, disabled }: Props) {
  const watchedContenidos = form.watch('contenidos_resumen') ?? '';

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
                  <Input
                    placeholder="Ej: Construcciones del Plata SA"
                    disabled={disabled}
                    {...field}
                  />
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
          <FormField
            control={form.control}
            name="domicilio"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Domicilio</FormLabel>
                <FormControl>
                  <Input placeholder="Ej: Av. Mitre 567" disabled={disabled} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* ===================================================================
            ACTIVIDAD FORMATIVA
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Actividad formativa
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="tema_principal"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Tema principal</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ej: Uso correcto de EPP en altura"
                    disabled={disabled}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="fecha_capacitacion"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha</FormLabel>
                <FormControl>
                  <Input type="date" disabled={disabled} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="modalidad"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Modalidad</FormLabel>
                <Select onValueChange={field.onChange} value={field.value} disabled={disabled}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegí una modalidad" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {MODALIDAD_CAPACITACION.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="duracion_horas"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Duración (horas)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.5"
                    min={0.5}
                    max={40}
                    disabled={disabled}
                    name={field.name}
                    ref={field.ref}
                    value={Number.isFinite(field.value) ? field.value : ''}
                    onBlur={field.onBlur}
                    onChange={(e) => {
                      const raw = e.target.value;
                      field.onChange(raw === '' ? Number.NaN : Number(raw));
                    }}
                  />
                </FormControl>
                <FormDescription>Permite decimales (0,5 = 30 min).</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="cantidad_asistentes_prevista"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Asistentes previstos</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    disabled={disabled}
                    name={field.name}
                    ref={field.ref}
                    value={Number.isFinite(field.value) ? field.value : ''}
                    onBlur={field.onBlur}
                    onChange={(e) => {
                      const raw = e.target.value;
                      field.onChange(raw === '' ? Number.NaN : Number(raw));
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="capacitador_nombre"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Capacitador</FormLabel>
                <FormControl>
                  <Input placeholder="Ej: Juan Pérez" disabled={disabled} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="capacitador_matricula"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Matrícula (opcional)</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ej: MN 12345"
                    disabled={disabled}
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || undefined)}
                  />
                </FormControl>
                <FormDescription>Si el capacitador no es matriculado, dejá vacío.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* ===================================================================
            CONTENIDOS
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Contenidos
        </h3>
        <FormField
          control={form.control}
          name="contenidos_resumen"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Resumen de contenidos (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  maxLength={CONTENIDOS_MAX}
                  placeholder="Ej: Tipos de EPP, normativa SRT, ejercicios prácticos de uso, criterios de descarte."
                  disabled={disabled}
                  {...field}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value || undefined)}
                />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                {watchedContenidos.length} / {CONTENIDOS_MAX} caracteres
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>
    </div>
  );
}
