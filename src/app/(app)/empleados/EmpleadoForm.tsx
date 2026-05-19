'use client';

import type { EmpleadoRow } from './queries';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { optionalString } from '@/shared/lib/zod-form-helpers';
import { CUIT_REGEX, normalizeCuit } from '@/shared/templates/common/cuit';
import { Button } from '@/shared/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Separator } from '@/shared/ui/separator';
import { Textarea } from '@/shared/ui/textarea';

import { createEmpleadoAction, updateEmpleadoAction } from './actions';

/**
 * T-054 · Form reusable crear/editar empleado.
 *
 * 3 secciones (Identificación / Contacto / Laboral) matcheando patrón T-049
 * `ClienteForm`. `cliente_id` viene de props (query param) — no es del form.
 *
 * **Decisión Zod-RHF**: schema LOCAL permisivo (`empleadoFormSchema`) en lugar
 * de `createEmpleadoSchema` de T-053. Razón: action schema rechaza `''` en
 * fields `.optional()` (min ≥1), pero RHF necesita defaults string. El form
 * acepta `''` como "no cargado"; `stripEmpty()` / `diffPatch()` convierten al
 * shape del action antes del invoke.
 *
 * **Fechas**: `<Input type="date" />` nativo devuelve ISO YYYY-MM-DD. NO
 * transformamos a Date object — el schema action valida con regex y el flow
 * permanece string → string puro.
 */

const optionalCuit = z
  .string()
  .trim()
  .refine((v) => v === '' || CUIT_REGEX.test(v), {
    message: 'Formato CUIL: XX-XXXXXXXX-X (con o sin guiones).',
  });

const optionalEmail = z
  .string()
  .trim()
  .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
    message: 'Email inválido.',
  });

const optionalDateIso = z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), {
  message: 'Formato fecha: YYYY-MM-DD.',
});

const empleadoFormSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(80, { message: 'Máximo 80 caracteres.' }),
  apellido: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(80, { message: 'Máximo 80 caracteres.' }),
  dni: z
    .string()
    .trim()
    .regex(/^\d[\d.\s-]{6,11}$/, {
      message: 'DNI inválido. Formato: 7-8 dígitos (con o sin puntos/espacios).',
    }),
  cuil: optionalCuit,
  email: optionalEmail,
  telefono: optionalString({ min: 6, max: 30, label: 'teléfono' }),
  puesto: optionalString({ min: 2, max: 120, label: 'puesto' }),
  fecha_ingreso: optionalDateIso,
  fecha_nacimiento: optionalDateIso,
  notas: z.string().trim().max(2000, { message: 'Máximo 2000 caracteres.' }),
});

type EmpleadoFormValues = z.infer<typeof empleadoFormSchema>;

const EMPTY_DEFAULTS: EmpleadoFormValues = {
  nombre: '',
  apellido: '',
  dni: '',
  cuil: '',
  email: '',
  telefono: '',
  puesto: '',
  fecha_ingreso: '',
  fecha_nacimiento: '',
  notas: '',
};

const OPTIONAL_KEYS = [
  'cuil',
  'email',
  'telefono',
  'puesto',
  'fecha_ingreso',
  'fecha_nacimiento',
  'notas',
] as const satisfies ReadonlyArray<keyof EmpleadoFormValues>;

function empleadoRowToFormValues(row: EmpleadoRow): EmpleadoFormValues {
  return {
    nombre: row.nombre,
    apellido: row.apellido,
    dni: row.dni,
    cuil: row.cuil ?? '',
    email: row.email ?? '',
    telefono: row.telefono ?? '',
    puesto: row.puesto ?? '',
    fecha_ingreso: row.fecha_ingreso ?? '',
    fecha_nacimiento: row.fecha_nacimiento ?? '',
    notas: row.notas ?? '',
  };
}

/** Omite keys con `''` antes de invocar createEmpleadoAction. */
function stripEmpty(values: EmpleadoFormValues, clienteId: string): Record<string, string> {
  const out: Record<string, string> = {
    cliente_id: clienteId,
    nombre: values.nombre,
    apellido: values.apellido,
    dni: values.dni,
  };
  for (const k of OPTIONAL_KEYS) {
    const v = values[k];
    if (v !== '') out[k] = v;
  }
  return out;
}

/**
 * Construye patch comparando values vs initial. Optionals que pasaron de
 * "tenía valor" a `''` se envían como `null`. Si no hay diff, retorna `null`
 * (caller muestra toast info).
 */
function diffPatch(
  initial: EmpleadoFormValues,
  values: EmpleadoFormValues,
): Record<string, string | null> | null {
  const patch: Record<string, string | null> = {};

  if (values.nombre !== initial.nombre) patch.nombre = values.nombre;
  if (values.apellido !== initial.apellido) patch.apellido = values.apellido;
  if (values.dni !== initial.dni) patch.dni = values.dni;

  for (const k of OPTIONAL_KEYS) {
    const initVal = initial[k];
    const newVal = values[k];
    if (initVal === newVal) continue;
    patch[k] = newVal === '' ? null : newVal;
  }

  if (Object.keys(patch).length === 0) return null;
  return patch;
}

type Props =
  | {
      mode: 'create';
      clienteId: string;
      clienteRazonSocial: string;
      initialValues?: never;
      empleadoId?: never;
    }
  | {
      mode: 'edit';
      clienteId: string;
      clienteRazonSocial: string;
      initialValues: EmpleadoRow;
      empleadoId: string;
    };

export function EmpleadoForm(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const initialFormValues =
    props.mode === 'edit' ? empleadoRowToFormValues(props.initialValues) : EMPTY_DEFAULTS;

  const form = useForm<EmpleadoFormValues>({
    resolver: zodResolver(empleadoFormSchema),
    defaultValues: initialFormValues,
  });

  function handleCuilBlur(currentValue: string, onBlur: () => void) {
    if (currentValue && CUIT_REGEX.test(currentValue)) {
      const normalized = normalizeCuit(currentValue);
      if (normalized !== currentValue) {
        form.setValue('cuil', normalized, { shouldDirty: true, shouldValidate: true });
      }
    }
    onBlur();
  }

  function onSubmit(values: EmpleadoFormValues) {
    if (props.mode === 'edit') {
      const patch = diffPatch(initialFormValues, values);
      if (patch === null) {
        toast.info('Sin cambios para guardar');
        return;
      }
      startTransition(async () => {
        const result = await updateEmpleadoAction(props.empleadoId, patch);
        handleResult(result, 'updated');
      });
      return;
    }

    const payload = stripEmpty(values, props.clienteId);
    startTransition(async () => {
      const result = await createEmpleadoAction(payload);
      handleResult(result, 'created');
    });
  }

  type ActionResult =
    | { ok: true; empleadoId: string }
    | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

  function handleResult(result: ActionResult, verb: 'created' | 'updated') {
    if (result.ok) {
      toast.success(verb === 'created' ? 'Empleado creado' : 'Cambios guardados');
      router.push(`/empleados/${result.empleadoId}`);
      router.refresh();
      return;
    }

    switch (result.code) {
      case 'INVALID_INPUT':
        if (result.fieldErrors) {
          for (const [field, msgs] of Object.entries(result.fieldErrors)) {
            const message = msgs[0];
            if (message && field in EMPTY_DEFAULTS) {
              form.setError(field as keyof EmpleadoFormValues, { message });
            }
          }
        }
        toast.error('Datos inválidos', { description: result.message });
        return;
      case 'DUPLICATE_DNI':
        form.setError('dni', {
          message: result.fieldErrors?.dni?.[0] ?? 'DNI duplicado.',
        });
        toast.error('DNI duplicado', { description: result.message });
        return;
      case 'CLIENTE_NOT_FOUND_OR_FORBIDDEN':
        toast.error('Cliente no encontrado', { description: result.message });
        router.push('/empleados');
        return;
      case 'NOT_FOUND':
        toast.error('Empleado no encontrado');
        router.push('/empleados');
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

  const submitLabel =
    props.mode === 'create'
      ? isPending
        ? 'Creando…'
        : 'Crear empleado'
      : isPending
        ? 'Guardando…'
        : 'Guardar cambios';

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6" noValidate>
        {props.mode === 'create' && (
          <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
            <span className="text-muted-foreground">Cliente:</span>{' '}
            <span className="text-foreground font-medium">{props.clienteRazonSocial}</span>
          </div>
        )}

        {/* SECCIÓN 1: Identificación */}
        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Identificación
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre *</FormLabel>
                  <FormControl>
                    <Input placeholder="Juan" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="apellido"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Apellido *</FormLabel>
                  <FormControl>
                    <Input placeholder="Pérez" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dni"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>DNI *</FormLabel>
                  <FormControl>
                    <Input placeholder="12345678" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="cuil"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CUIL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="20-12345678-9"
                      {...field}
                      disabled={isPending}
                      onBlur={() => handleCuilBlur(field.value, field.onBlur)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <Separator />

        {/* SECCIÓN 2: Contacto */}
        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Contacto
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="juan@acme.com.ar"
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
              name="telefono"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teléfono</FormLabel>
                  <FormControl>
                    <Input placeholder="011 4444-5555" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <Separator />

        {/* SECCIÓN 3: Laboral */}
        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Laboral
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="puesto"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Puesto</FormLabel>
                  <FormControl>
                    <Input placeholder="Operario de máquinas" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fecha_ingreso"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de ingreso</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fecha_nacimiento"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de nacimiento</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notas"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Notas internas</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      placeholder="Notas para tu equipo (no se incluyen en informes)…"
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
