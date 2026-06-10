'use client';

import type { UseFormReturn } from 'react-hook-form';
import type { RelevamientoMetadata } from './schema';

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

import { AREAS_RELEVADAS_PRESETS } from '../common/areas';
import { normalizeCuit } from '../common/cuit';
import { PersonalizacionSection } from '../common/PersonalizacionSection';
import { defaultSeccionesConfig, esSeleccionDefault } from '../common/secciones';
import { SeccionesConfigField } from '../common/SeccionesConfigField';
import { PROVINCIAS_AR } from '../common/site';
import { AGENTES_HYS } from './schema';
import { SECCION_IDS_RELEVAMIENTO, SECCIONES_RELEVAMIENTO } from './secciones';

/**
 * T-022 · Form Relevamiento. Distinto del RGRL: este es un informe tecnico de
 * mediciones puntual (no el formulario anual SRT).
 *
 * Secciones:
 *  - Cliente (5 fields, con sitio).
 *  - Sitio (areas relevadas + agentes a relevar).
 *  - Relevamiento (fecha + equipos opcionales).
 */

const EQUIPOS_MAX = 2000;
const TODAY_ISO = (): string => new Date().toISOString().slice(0, 10);

export const relevamientoMetadataDefaults = (): RelevamientoMetadata => ({
  razon_social: '',
  cuit: '',
  domicilio: '',
  localidad: '',
  provincia: 'CABA',
  fecha_relevamiento: TODAY_ISO(),
  areas_relevadas: ['Oficinas administrativas', 'Producción / planta'],
  agentes_a_relevar: ['ruido', 'iluminacion'],
  equipos_medicion: '',
  campos_personalizados: [],
  instrucciones_adicionales: '',
  secciones: defaultSeccionesConfig(SECCION_IDS_RELEVAMIENTO),
});

type Props = {
  form: UseFormReturn<RelevamientoMetadata>;
  disabled?: boolean;
};

export function RelevamientoMetadataForm({ form, disabled }: Props) {
  const watchedEquipos = form.watch('equipos_medicion') ?? '';

  const watchedAreas = form.watch('areas_relevadas') ?? [];

  const watchedAgentes = form.watch('agentes_a_relevar') ?? [];

  function toggleArea(area: string, checked: boolean) {
    const current = form.getValues('areas_relevadas') ?? [];
    const next = checked
      ? Array.from(new Set([...current, area]))
      : current.filter((a) => a !== area);
    form.setValue('areas_relevadas', next, { shouldDirty: true, shouldValidate: true });
  }

  function commitOtrasAreas(raw: string) {
    const fromTextarea = raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const checked = form.getValues('areas_relevadas') ?? [];
    const checkedPresets = checked.filter((a) =>
      (AREAS_RELEVADAS_PRESETS as readonly string[]).includes(a),
    );

    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of [...checkedPresets, ...fromTextarea]) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }

    form.setValue('areas_relevadas', result.slice(0, 20), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function toggleAgente(value: (typeof AGENTES_HYS)[number]['value'], checked: boolean) {
    const current = form.getValues('agentes_a_relevar') ?? [];
    const next = checked
      ? Array.from(new Set([...current, value]))
      : current.filter((a) => a !== value);
    form.setValue('agentes_a_relevar', next, { shouldDirty: true, shouldValidate: true });
  }

  const otrasAreasText = watchedAreas
    .filter((a) => !(AREAS_RELEVADAS_PRESETS as readonly string[]).includes(a))
    .join('\n');

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
                  <Input placeholder="Ej: Frigorífico del Sur SRL" disabled={disabled} {...field} />
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
                  <Input placeholder="Ej: Ruta 8 Km 47" disabled={disabled} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="localidad"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Localidad</FormLabel>
                <FormControl>
                  <Input placeholder="Ej: Pilar" disabled={disabled} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="provincia"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Provincia</FormLabel>
                <Select onValueChange={field.onChange} value={field.value} disabled={disabled}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegí una provincia" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PROVINCIAS_AR.map((p) => (
                      <SelectItem key={p.code} value={p.code}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* ===================================================================
            SITIO (areas + agentes)
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Sitio
        </h3>

        <FormField
          control={form.control}
          name="areas_relevadas"
          render={() => (
            <FormItem>
              <FormLabel>Áreas relevadas</FormLabel>
              <FormDescription>
                Marcá las áreas estándar y agregá las propias del establecimiento.
              </FormDescription>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {AREAS_RELEVADAS_PRESETS.map((area) => {
                  const id = `rel-area-${area.replace(/\s+/g, '-').toLowerCase()}`;
                  const checked = watchedAreas.includes(area);
                  return (
                    <div key={area} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(c) => toggleArea(area, c === true)}
                      />
                      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
                        {area}
                      </Label>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 space-y-1">
                <Label
                  htmlFor="rel-otras-areas"
                  className="text-sm font-normal text-muted-foreground"
                >
                  Otras áreas (una por línea)
                </Label>
                <Textarea
                  id="rel-otras-areas"
                  rows={3}
                  placeholder="Ej:&#10;Cocina industrial&#10;Pañol de herramientas"
                  defaultValue={otrasAreasText}
                  disabled={disabled}
                  onBlur={(e) => commitOtrasAreas(e.target.value)}
                />
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="agentes_a_relevar"
          render={() => (
            <FormItem>
              <FormLabel>Agentes a relevar</FormLabel>
              <FormDescription>Marcá los agentes HyS a medir en el relevamiento.</FormDescription>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {AGENTES_HYS.map((agente) => {
                  const id = `rel-agente-${agente.value}`;
                  const checked = watchedAgentes.includes(agente.value);
                  return (
                    <div key={agente.value} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(c) => toggleAgente(agente.value, c === true)}
                      />
                      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
                        {agente.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>

      <Separator />

      {/* ===================================================================
            RELEVAMIENTO
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Relevamiento
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="fecha_relevamiento"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha del relevamiento</FormLabel>
                <FormControl>
                  <Input type="date" disabled={disabled} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="equipos_medicion"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Equipos de medición (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  maxLength={EQUIPOS_MAX}
                  placeholder="Ej: Sonómetro Quest 2900, datalogger WBGT TES-1369, luxómetro Extech LT300."
                  disabled={disabled}
                  {...field}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value || undefined)}
                />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                {watchedEquipos.length} / {EQUIPOS_MAX} caracteres
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>

      {/* T-138 · Personalizacion compartida (campos + secciones + instrucciones).
          abrirSi: estructura guardada distinta del default no debe quedar oculta. */}
      <PersonalizacionSection
        form={form}
        disabled={disabled}
        abrirSi={!esSeleccionDefault(form.getValues('secciones') ?? [], SECCION_IDS_RELEVAMIENTO)}
      >
        <SeccionesConfigField form={form} catalogo={SECCIONES_RELEVAMIENTO} disabled={disabled} />
      </PersonalizacionSection>
    </div>
  );
}
