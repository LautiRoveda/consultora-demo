'use client';

import type { CorregirIncidenteResult, RegisterIncidenteResult } from './actions';
import type { IncidenteRow } from './queries';
import type { CreateIncidenteInput, GravedadIncidente, TipoIncidente } from './schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { todayCivilIsoAR } from '@/shared/lib/format-date';
import { optionalString } from '@/shared/lib/zod-form-helpers';
import { FECHA_ISO_REGEX, HORA_HHMM_REGEX } from '@/shared/templates/common/sanitize';
import { Button } from '@/shared/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Separator } from '@/shared/ui/separator';
import { Textarea } from '@/shared/ui/textarea';

import { corregirIncidenteAction, registerIncidenteAction } from './actions';
import { GRAVEDAD_INCIDENTE, TIPO_INCIDENTE } from './schema';

/**
 * T-063 · Form compartido alta/corrección del libro de incidentes.
 *
 * **Decisión Zod-RHF** (calca `ClienteForm` T-049): usa un schema LOCAL tolerante
 * de `''` en lugar de `createIncidenteSchema`. Razón: los FK opcionales son uuid
 * (un `Select` Radix no puede valer `''`), los textos opcionales tienen
 * min-length (`''` fallaría) y `dias_perdidos` es number sin coerce. El form
 * acepta `''`/sentinel `NONE` como "no cargado", y `toCreateInput()` mapea al
 * shape de la action. La regla tipo↔gravedad se replica en un `superRefine` para
 * que el error salga inline (no sólo en el round-trip server). Tres capas de
 * defensa: form schema + action Zod + CHECK SQL.
 *
 * Gotchas aplicados (docs/technical/07-zod-rhf-gotchas.md): sin `z.coerce`,
 * `z.preprocess` ni `z.transform`; `defaultValues` completos; normalización en
 * mappers post-validate.
 */

type ClienteOption = { id: string; razon_social: string };
type EmpleadoOption = {
  id: string;
  nombre: string;
  apellido: string;
  dni: string | null;
  cliente_id: string;
  cliente_razon_social: string;
};

const NONE = '__none__';

// `fechaNoFuturoField` no se exporta de schema.ts → la reconstruimos (fechaIso
// + refine no-futuro). Usamos "hoy" en TZ AR: siempre ≤ el "hoy UTC" que valida
// la action, así que el form nunca acepta algo que la action rechazaría.
const fechaNoFuturoField = z
  .string()
  .regex(FECHA_ISO_REGEX, { message: 'Formato YYYY-MM-DD.' })
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Fecha inválida.' })
  .refine((v) => v <= todayCivilIsoAR(), { message: 'La fecha no puede ser futura.' });

const incidenteFormSchema = z
  .object({
    tipo: z.enum(['casi_accidente', 'accidente'], { message: 'Elegí el tipo de incidente.' }),
    fecha: fechaNoFuturoField,
    hora: z
      .string()
      .trim()
      .refine((v) => v === '' || HORA_HHMM_REGEX.test(v), {
        message: 'Formato HH:MM (24h).',
      }),
    cliente_id: z.string(),
    empleado_id: z.string(),
    lugar_especifico: optionalString({ min: 3, max: 200, label: 'el lugar' }),
    descripcion: z
      .string()
      .trim()
      .min(10, { message: 'Mínimo 10 caracteres — describí qué pasó.' })
      .max(4000, { message: 'Máximo 4000 caracteres.' }),
    causa_raiz: optionalString({ min: 1, max: 4000, label: 'la causa raíz' }),
    accion_inmediata: optionalString({ min: 1, max: 2000, label: 'la acción inmediata' }),
    gravedad: z.string(),
    dias_perdidos: z
      .number({ message: 'Ingresá un número de días.' })
      .int({ message: 'Debe ser un número entero de días.' })
      .min(0, { message: 'Mínimo 0 días.' })
      .max(3650, { message: 'Máximo 3650 días.' })
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.tipo === 'accidente') {
      if (val.gravedad === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['gravedad'],
          message: 'Gravedad requerida para un accidente con lesión.',
        });
      }
    } else {
      if (val.gravedad !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['gravedad'],
          message: 'Un casi-accidente no lleva gravedad (no hubo lesión).',
        });
      }
      if (val.dias_perdidos != null && val.dias_perdidos !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dias_perdidos'],
          message: 'Un casi-accidente no lleva días perdidos (no hubo lesión).',
        });
      }
    }
  });

type IncidenteFormValues = z.infer<typeof incidenteFormSchema>;

const EMPTY_DEFAULTS: IncidenteFormValues = {
  tipo: 'casi_accidente',
  fecha: '',
  hora: '',
  cliente_id: NONE,
  empleado_id: NONE,
  lugar_especifico: '',
  descripcion: '',
  causa_raiz: '',
  accion_inmediata: '',
  gravedad: '',
  dias_perdidos: undefined,
};

function incidenteRowToFormValues(row: IncidenteRow): IncidenteFormValues {
  return {
    tipo: row.tipo,
    fecha: row.fecha,
    // La columna `time` viene como 'HH:MM:SS'; el form (y el regex HH:MM) usan
    // 'HH:MM' → recortamos para no romper la validación al prellenar.
    hora: row.hora ? row.hora.slice(0, 5) : '',
    cliente_id: row.cliente_id ?? NONE,
    empleado_id: row.empleado_id ?? NONE,
    lugar_especifico: row.lugar_especifico ?? '',
    descripcion: row.descripcion,
    causa_raiz: row.causa_raiz ?? '',
    accion_inmediata: row.accion_inmediata ?? '',
    gravedad: row.gravedad ?? '',
    dias_perdidos: row.dias_perdidos ?? undefined,
  };
}

/** Mapea los values del form (con `''`/`NONE`) al shape de la action. */
function toCreateInput(v: IncidenteFormValues): CreateIncidenteInput {
  const trimOrUndef = (s: string) => (s.trim() === '' ? undefined : s.trim());
  return {
    tipo: v.tipo,
    fecha: v.fecha,
    hora: trimOrUndef(v.hora),
    cliente_id: v.cliente_id === NONE ? undefined : v.cliente_id,
    empleado_id: v.empleado_id === NONE ? undefined : v.empleado_id,
    lugar_especifico: trimOrUndef(v.lugar_especifico),
    descripcion: v.descripcion.trim(),
    causa_raiz: trimOrUndef(v.causa_raiz),
    accion_inmediata: trimOrUndef(v.accion_inmediata),
    gravedad: v.gravedad === '' ? undefined : (v.gravedad as GravedadIncidente),
    dias_perdidos: v.dias_perdidos,
  };
}

type Props =
  | {
      mode: 'create';
      clientes: ClienteOption[];
      empleados: EmpleadoOption[];
      corrigeId?: never;
      initialValues?: never;
    }
  | {
      mode: 'corregir';
      clientes: ClienteOption[];
      empleados: EmpleadoOption[];
      corrigeId: string;
      initialValues: IncidenteRow;
    };

export function IncidenteForm(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const initialFormValues =
    props.mode === 'corregir' ? incidenteRowToFormValues(props.initialValues) : EMPTY_DEFAULTS;

  const form = useForm<IncidenteFormValues>({
    resolver: zodResolver(incidenteFormSchema),
    defaultValues: initialFormValues,
  });

  const tipo = useWatch({ control: form.control, name: 'tipo' });
  const clienteId = useWatch({ control: form.control, name: 'cliente_id' });
  const isAccidente = tipo === 'accidente';

  const empleadosFiltrados = useMemo(() => {
    if (clienteId === NONE) return props.empleados;
    return props.empleados.filter((e) => e.cliente_id === clienteId);
  }, [clienteId, props.empleados]);

  function handleTipoChange(next: TipoIncidente) {
    form.setValue('tipo', next, { shouldValidate: true });
    // Al pasar a casi-accidente limpiamos los campos de lesión para que no
    // disparen el superRefine ni el CHECK SQL con valores stale.
    if (next === 'casi_accidente') {
      form.setValue('gravedad', '', { shouldValidate: false });
      form.setValue('dias_perdidos', undefined, { shouldValidate: false });
    }
  }

  function handleClienteChange(next: string) {
    form.setValue('cliente_id', next, { shouldValidate: true });
    // Si el empleado seleccionado no pertenece al nuevo cliente, lo limpiamos.
    const emp = form.getValues('empleado_id');
    if (emp !== NONE && next !== NONE) {
      const belongs = props.empleados.some((e) => e.id === emp && e.cliente_id === next);
      if (!belongs) form.setValue('empleado_id', NONE);
    }
  }

  function handleResult(result: RegisterIncidenteResult | CorregirIncidenteResult) {
    if (result.ok) {
      toast.success(props.mode === 'create' ? 'Incidente registrado' : 'Corrección registrada');
      router.push(`/accidentabilidad/${result.incidenteId}`);
      router.refresh();
      return;
    }

    switch (result.code) {
      case 'INVALID_INPUT':
        for (const [field, msgs] of Object.entries(result.fieldErrors)) {
          const message = msgs[0];
          if (message && field in EMPTY_DEFAULTS) {
            form.setError(field as keyof IncidenteFormValues, { message });
          }
        }
        toast.error('Datos inválidos', { description: result.message });
        return;
      case 'CROSS_TENANT_REF':
        toast.error('Referencia inválida', { description: result.message });
        return;
      case 'ALREADY_CORRECTED':
        toast.error('Ese incidente ya fue corregido o anulado', { description: result.message });
        if (props.mode === 'corregir') {
          router.push(`/accidentabilidad/${props.corrigeId}`);
          router.refresh();
        }
        return;
      case 'NOT_FOUND':
        toast.error('Incidente no encontrado', { description: result.message });
        router.push('/accidentabilidad');
        return;
      case 'BILLING_GATED':
        toast.error('Plan expirado', {
          description: result.message,
          action: { label: 'Suscribirme', onClick: () => router.push('/settings/billing') },
        });
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: result.message });
        return;
      default:
        toast.error('Error inesperado', { description: result.message });
    }
  }

  function onSubmit(values: IncidenteFormValues) {
    const input = toCreateInput(values);
    startTransition(async () => {
      if (props.mode === 'corregir') {
        const result = await corregirIncidenteAction({ ...input, corrige_id: props.corrigeId });
        handleResult(result);
      } else {
        const result = await registerIncidenteAction(input);
        handleResult(result);
      }
    });
  }

  const submitLabel =
    props.mode === 'create'
      ? isPending
        ? 'Registrando…'
        : 'Registrar incidente'
      : isPending
        ? 'Guardando…'
        : 'Guardar corrección';

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6" noValidate>
        {/* SECCIÓN 1: Clasificación */}
        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Clasificación
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Tipo de incidente *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => handleTipoChange(v as TipoIncidente)}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TIPO_INCIDENTE.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
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
              name="fecha"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha *</FormLabel>
                  <FormControl>
                    <Input type="date" max={todayCivilIsoAR()} {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hora"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hora</FormLabel>
                  <FormControl>
                    <Input type="time" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <Separator />

        {/* SECCIÓN 2: Contexto */}
        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Contexto
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="cliente_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente (dónde ocurrió)</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={handleClienteChange}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sin especificar" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin especificar</SelectItem>
                      {props.clientes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.razon_social}
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
              name="empleado_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Empleado (víctima)</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={isPending}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sin especificar" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin especificar</SelectItem>
                      {empleadosFiltrados.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.apellido}, {e.nombre}
                          {e.dni ? ` · DNI ${e.dni}` : ''}
                          {clienteId === NONE ? ` — ${e.cliente_razon_social}` : ''}
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
              name="lugar_especifico"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Lugar específico</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej: sector de prensas, escalera del depósito…"
                      {...field}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <Separator />

        {/* SECCIÓN 3: Descripción */}
        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Descripción
          </h3>
          <div className="grid grid-cols-1 gap-4">
            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>¿Qué pasó? *</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      placeholder="Describí la secuencia, el lugar y las condiciones del hecho…"
                      {...field}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="causa_raiz"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Causa raíz</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Investigación preventiva: por qué ocurrió (factores, condiciones)…"
                      {...field}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accion_inmediata"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Acción inmediata</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Qué se hizo en el momento para contener el riesgo…"
                      {...field}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        {/* SECCIÓN 4: Lesión — sólo accidente (con lesión). */}
        {isAccidente && (
          <>
            <Separator />
            <section className="space-y-4">
              <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
                Lesión
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="gravedad"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gravedad *</FormLabel>
                      <Select
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                        disabled={isPending}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Elegí la gravedad" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {GRAVEDAD_INCIDENTE.map((g) => (
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
                  name="dias_perdidos"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Días perdidos</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={3650}
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          value={
                            typeof field.value === 'number' && Number.isFinite(field.value)
                              ? field.value
                              : ''
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            field.onChange(raw === '' ? undefined : Number(raw));
                          }}
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </section>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
