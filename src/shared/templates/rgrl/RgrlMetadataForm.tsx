'use client';

import type { UseFormReturn } from 'react-hook-form';
import type { RgrlMetadata } from './schema';

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

import { PersonalizacionSection } from '../common/PersonalizacionSection';
import {
  AREAS_RELEVADAS_PRESETS,
  DISTRIBUCION_TURNO,
  MODALIDAD_OPERATIVA,
  normalizeCuit,
  PROVINCIAS_AR,
  SERVICIO_HYS_MODALIDAD,
} from './schema';

/**
 * T-021 · Form RGRL renderizable como step 2 del wizard /informes/nuevo Y
 * como panel dentro del Collapsible de /editar.
 *
 * Recibe el `UseFormReturn` desde afuera para que el caller controle:
 * - El submit (en wizard, va a `createInformeAction({...step1, metadata})`;
 *   en /editar, va a `updateInformeMetadataAction`).
 * - El estado `disabled` (durante un submit en curso).
 *
 * Layout:
 * - 1 col mobile, 2 cols desktop (`md:grid-cols-2`).
 * - 5 secciones separadas por `<Separator>` + heading `<h3>`:
 *   Identificación, Actividad, Operación, Cobertura y servicio HyS, Relevamiento.
 *
 * Campos especiales: ver comentarios inline (areas_relevadas, cuit).
 */

const RIESGOS_MAX = 2000;
const TODAY_ISO = (): string => new Date().toISOString().slice(0, 10);

export const rgrlMetadataDefaults = (): RgrlMetadata => ({
  razon_social: '',
  // Placeholder con regex valido. El user lo sobrescribe; si lo deja, el
  // Zod regex lo permite (00-00000000-0 matchea formato) y persistira como
  // "[A COMPLETAR]" visualmente en el output del LLM (no es realista).
  cuit: '',
  domicilio: '',
  localidad: '',
  provincia: 'CABA',
  actividad_principal: '',
  codigo_ciiu: '',
  cantidad_empleados: 1,
  distribucion_turno: 'unico',
  modalidad_operativa: 'industrial',
  art_contratada: '',
  servicio_hys_modalidad: 'externo',
  areas_relevadas: ['Oficinas administrativas', 'Producción / planta'],
  riesgos_pre_detectados: '',
  fecha_relevamiento: TODAY_ISO(),
  campos_personalizados: [],
  instrucciones_adicionales: '',
});

type Props = {
  form: UseFormReturn<RgrlMetadata>;
  disabled?: boolean;
};

export function RgrlMetadataForm({ form, disabled }: Props) {
  const watchedRiesgos = form.watch('riesgos_pre_detectados') ?? '';
  const watchedAreas = form.watch('areas_relevadas') ?? [];

  function toggleArea(area: string, checked: boolean) {
    const current = form.getValues('areas_relevadas') ?? [];
    const next = checked
      ? Array.from(new Set([...current, area]))
      : current.filter((a) => a !== area);
    form.setValue('areas_relevadas', next, { shouldDirty: true, shouldValidate: true });
  }

  /**
   * Parsea el textarea de "otras areas" (una por linea), combina con los
   * checkboxes marcados, dedup case-insensitive, cap a 20. Se ejecuta onBlur
   * del textarea para no spamear setValue por cada caracter.
   */
  function commitOtrasAreas(raw: string) {
    const fromTextarea = raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const checked = form.getValues('areas_relevadas') ?? [];
    // Mantener solo los presets actualmente marcados; el resto viene del textarea.
    const checkedPresets = checked.filter((a) =>
      (AREAS_RELEVADAS_PRESETS as readonly string[]).includes(a),
    );

    // Dedup case-insensitive sin perder el casing del primer encontrado.
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

  /**
   * Lineas del textarea = solo las areas que NO son presets. Recalcula desde
   * `watchedAreas` para que el textarea se sincronice con cambios externos.
   */
  const otrasAreasText = watchedAreas
    .filter((a) => !(AREAS_RELEVADAS_PRESETS as readonly string[]).includes(a))
    .join('\n');

  return (
    <div className="space-y-6">
      {/* ===================================================================
            IDENTIFICACION
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Identificación
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="razon_social"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Razón social</FormLabel>
                <FormControl>
                  <Input placeholder="Ej: Metalúrgica del Sur SA" disabled={disabled} {...field} />
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
                  <Input placeholder="Ej: Av. Industrial 1234" disabled={disabled} {...field} />
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
                  <Input placeholder="Ej: Tigre" disabled={disabled} {...field} />
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
            ACTIVIDAD
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Actividad
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="actividad_principal"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Actividad principal</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ej: Fabricación de estructuras metálicas"
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
            name="codigo_ciiu"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Código CIIU (opcional)</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ej: 25110"
                    disabled={disabled}
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || undefined)}
                  />
                </FormControl>
                <FormDescription>
                  Código de 4 a 6 dígitos (sin punto). Si no lo sabés, dejalo vacío.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* ===================================================================
            OPERACION
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Operación
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="cantidad_empleados"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cantidad de empleados</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={50000}
                    disabled={disabled}
                    name={field.name}
                    ref={field.ref}
                    value={Number.isFinite(field.value) ? field.value : ''}
                    onBlur={field.onBlur}
                    onChange={(e) => {
                      const raw = e.target.value;
                      // Empty input → NaN (Zod number() rechaza con message clara).
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
            name="distribucion_turno"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Distribución de turnos</FormLabel>
                <Select onValueChange={field.onChange} value={field.value} disabled={disabled}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegí una opción" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {DISTRIBUCION_TURNO.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
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
            name="modalidad_operativa"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Modalidad operativa</FormLabel>
                <Select onValueChange={field.onChange} value={field.value} disabled={disabled}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegí una opción" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {MODALIDAD_OPERATIVA.map((m) => (
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
        </div>
      </section>

      <Separator />

      {/* ===================================================================
            COBERTURA Y SERVICIO HYS
          =================================================================== */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium tracking-tight uppercase text-muted-foreground">
          Cobertura y servicio HyS
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="art_contratada"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ART contratada</FormLabel>
                <FormControl>
                  <Input placeholder="Ej: La Segunda" disabled={disabled} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="servicio_hys_modalidad"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Modalidad del servicio HyS</FormLabel>
                <Select onValueChange={field.onChange} value={field.value} disabled={disabled}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegí una opción" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {SERVICIO_HYS_MODALIDAD.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
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

        {/* Checkbox group de areas presets + textarea libre. */}
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
                  const id = `area-${area.replace(/\s+/g, '-').toLowerCase()}`;
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
                <Label htmlFor="otras-areas" className="text-sm font-normal text-muted-foreground">
                  Otras áreas (una por línea)
                </Label>
                <Textarea
                  id="otras-areas"
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
          name="riesgos_pre_detectados"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Riesgos pre-detectados (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  maxLength={RIESGOS_MAX}
                  placeholder="Ej: Ruido sostenido en línea de prensa. Manipulación manual de cargas en depósito."
                  disabled={disabled}
                  {...field}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value || undefined)}
                />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                {watchedRiesgos.length} / {RIESGOS_MAX} caracteres
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
