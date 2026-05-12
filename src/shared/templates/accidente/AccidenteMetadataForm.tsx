'use client';

import type { UseFormReturn } from 'react-hook-form';
import type { AccidenteMetadata } from './schema';

import { Checkbox } from '@/shared/ui/checkbox';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Separator } from '@/shared/ui/separator';
import { Textarea } from '@/shared/ui/textarea';

import { normalizeCuit } from '../common/cuit';
import { GRAVEDAD, PARTES_CUERPO, TIPO_LESION } from './schema';

/**
 * T-022 · Form Accidente. 12 campos en 4 secciones.
 *
 * Secciones:
 *  - Cliente (3 fields).
 *  - Hechos (4 fields: fecha, hora, lugar, puesto).
 *  - Lesión (4 fields: tipo, partes, gravedad, dias_baja).
 *  - Descripción (descripcion_inicial obligatoria + testigos_presentes).
 *
 * dias_baja_estimados: opcional. El onChange convierte '' → undefined
 * (no NaN) para que `.optional()` matchee correctamente.
 */

const DESCRIPCION_MAX = 4000;
const TODAY_ISO = (): string => new Date().toISOString().slice(0, 10);

export const accidenteMetadataDefaults = (): AccidenteMetadata => ({
  razon_social: '',
  cuit: '',
  domicilio: '',
  fecha_accidente: TODAY_ISO(),
  hora_accidente: '08:00',
  lugar_especifico: '',
  puesto_afectado: '',
  tipo_lesion: ['contusion'],
  partes_cuerpo_afectadas: ['manos'],
  gravedad: 'leve',
  dias_baja_estimados: undefined,
  testigos_presentes: false,
  descripcion_inicial: '',
});

type Props = {
  form: UseFormReturn<AccidenteMetadata>;
  disabled?: boolean;
};

export function AccidenteMetadataForm({ form, disabled }: Props) {
  const watchedDescripcion = form.watch('descripcion_inicial') ?? '';

  const watchedLesion = form.watch('tipo_lesion') ?? [];

  const watchedPartes = form.watch('partes_cuerpo_afectadas') ?? [];

  function toggleLesion(value: (typeof TIPO_LESION)[number]['value'], checked: boolean) {
    const current = form.getValues('tipo_lesion') ?? [];
    const next = checked
      ? Array.from(new Set([...current, value]))
      : current.filter((a) => a !== value);
    form.setValue('tipo_lesion', next, { shouldDirty: true, shouldValidate: true });
  }

  function toggleParte(value: (typeof PARTES_CUERPO)[number]['value'], checked: boolean) {
    const current = form.getValues('partes_cuerpo_afectadas') ?? [];
    const next = checked
      ? Array.from(new Set([...current, value]))
      : current.filter((a) => a !== value);
    form.setValue('partes_cuerpo_afectadas', next, { shouldDirty: true, shouldValidate: true });
  }

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
                    placeholder="Ej: Talleres Metalúrgicos SA"
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
                  <Input placeholder="Ej: Calle 9 de Julio 1500" disabled={disabled} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* ===================================================================
            HECHOS
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Hechos
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="fecha_accidente"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha del accidente</FormLabel>
                <FormControl>
                  <Input type="date" disabled={disabled} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="hora_accidente"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Hora del accidente</FormLabel>
                <FormControl>
                  <Input type="time" disabled={disabled} {...field} />
                </FormControl>
                <FormDescription>Formato HH:MM (24h).</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lugar_especifico"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Lugar específico</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ej: Línea de prensa, sector B"
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
            name="puesto_afectado"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Puesto afectado</FormLabel>
                <FormControl>
                  <Input placeholder="Ej: Operario de prensa" disabled={disabled} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* ===================================================================
            LESION
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Lesión
        </h3>

        <FormField
          control={form.control}
          name="tipo_lesion"
          render={() => (
            <FormItem>
              <FormLabel>Tipo(s) de lesión</FormLabel>
              <FormDescription>
                Base Anexo I Res. SRT 1604/07. Usá &quot;Otros&quot; para casos no listados.
              </FormDescription>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {TIPO_LESION.map((t) => {
                  const id = `acc-lesion-${t.value}`;
                  const checked = watchedLesion.includes(t.value);
                  return (
                    <div key={t.value} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(c) => toggleLesion(t.value, c === true)}
                      />
                      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
                        {t.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="partes_cuerpo_afectadas"
          render={() => (
            <FormItem>
              <FormLabel>Parte(s) del cuerpo afectada(s)</FormLabel>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {PARTES_CUERPO.map((p) => {
                  const id = `acc-parte-${p.value}`;
                  const checked = watchedPartes.includes(p.value);
                  return (
                    <div key={p.value} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(c) => toggleParte(p.value, c === true)}
                      />
                      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
                        {p.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="gravedad"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Gravedad</FormLabel>
                <Select onValueChange={field.onChange} value={field.value} disabled={disabled}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegí una gravedad" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {GRAVEDAD.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
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
            name="dias_baja_estimados"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Días de baja estimados (opcional)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    disabled={disabled}
                    name={field.name}
                    ref={field.ref}
                    value={
                      typeof field.value === 'number' && Number.isFinite(field.value)
                        ? field.value
                        : ''
                    }
                    onBlur={field.onBlur}
                    onChange={(e) => {
                      const raw = e.target.value;
                      // T-022 gotcha: optional number → '' debe ser undefined,
                      // no NaN, para que `.optional()` matchee.
                      field.onChange(raw === '' ? undefined : Number(raw));
                    }}
                  />
                </FormControl>
                <FormDescription>Dejá vacío si todavía no hay diagnóstico médico.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* ===================================================================
            DESCRIPCION
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Descripción
        </h3>

        <FormField
          control={form.control}
          name="testigos_presentes"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2 space-y-0">
              <FormControl>
                <Checkbox
                  id="acc-testigos"
                  checked={field.value}
                  disabled={disabled}
                  onCheckedChange={(c) => field.onChange(c === true)}
                />
              </FormControl>
              <Label htmlFor="acc-testigos" className="cursor-pointer text-sm font-normal">
                Hubo testigos presentes
              </Label>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="descripcion_inicial"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción inicial del accidente</FormLabel>
              <FormDescription>
                Describí brevemente qué pasó. NO incluyas nombres de testigos ni conclusiones de
                causa raíz — eso queda para la investigación formal.
              </FormDescription>
              <FormControl>
                <Textarea
                  rows={5}
                  maxLength={DESCRIPCION_MAX}
                  placeholder="Ej: Operario sufrió corte en mano derecha al retirar guarda de seguridad para destrabar pieza en la prensa."
                  disabled={disabled}
                  {...field}
                />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                {watchedDescripcion.length} / {DESCRIPCION_MAX} caracteres
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>
    </div>
  );
}
