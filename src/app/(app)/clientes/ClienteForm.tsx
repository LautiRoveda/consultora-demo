'use client';

import type { ClienteRow } from './queries';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { optionalString } from '@/shared/lib/zod-form-helpers';
import { CUIT_REGEX, cuitField, normalizeCuit } from '@/shared/templates/common/cuit';
import { PROVINCIAS_AR } from '@/shared/templates/common/site';
import { Button } from '@/shared/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Separator } from '@/shared/ui/separator';
import { Textarea } from '@/shared/ui/textarea';

import { createClienteAction, updateClienteAction } from './actions';

/**
 * T-049 · Form reusable crear/editar cliente.
 *
 * 4 secciones (Identificación / Ubicación / Contacto / Detalles) matcheando
 * patrón `RgrlMetadataForm` T-021.
 *
 * **Decisión Zod-RHF**: el form usa schema LOCAL (`clienteFormSchema`) en lugar
 * del `createClienteSchema` de T-048. Razón: T-048 schema rechaza `''` en
 * fields `.optional()` (min ≥1 char), pero RHF necesita defaults string (no
 * undefined) para evitar uncontrolled→controlled warning. El form acepta `''`
 * como "no cargado", y `stripEmpty()` / `diffPatch()` convierten al shape del
 * action antes del invoke. Tres niveles de defensa (form schema + action Zod +
 * SQL CHECK) garantizan que datos inválidos no llegan a DB.
 */

const optionalEmail = z
  .string()
  .trim()
  .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
    message: 'Email inválido.',
  });

const clienteFormSchema = z.object({
  razon_social: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),
  cuit: cuitField,
  nombre_fantasia: optionalString({ max: 120, label: 'nombre fantasía' }),
  domicilio: optionalString({ min: 3, max: 200, label: 'domicilio' }),
  localidad: optionalString({ min: 2, max: 80, label: 'localidad' }),
  provincia: optionalString({ max: 100, label: 'provincia' }),
  contacto_nombre: optionalString({ min: 2, max: 120, label: 'nombre de contacto' }),
  contacto_email: optionalEmail,
  contacto_telefono: optionalString({ min: 6, max: 30, label: 'teléfono' }),
  industria: optionalString({ max: 80, label: 'industria' }),
  art: optionalString({ max: 100, label: 'ART' }),
  notas: z.string().trim().max(2000, { message: 'Máximo 2000 caracteres.' }),
});

type ClienteFormValues = z.infer<typeof clienteFormSchema>;

const EMPTY_DEFAULTS: ClienteFormValues = {
  razon_social: '',
  cuit: '',
  nombre_fantasia: '',
  domicilio: '',
  localidad: '',
  provincia: '',
  contacto_nombre: '',
  contacto_email: '',
  contacto_telefono: '',
  industria: '',
  art: '',
  notas: '',
};

const OPTIONAL_KEYS = [
  'nombre_fantasia',
  'domicilio',
  'localidad',
  'provincia',
  'contacto_nombre',
  'contacto_email',
  'contacto_telefono',
  'industria',
  'art',
  'notas',
] as const satisfies ReadonlyArray<keyof ClienteFormValues>;

function clienteRowToFormValues(row: ClienteRow): ClienteFormValues {
  return {
    razon_social: row.razon_social,
    cuit: row.cuit,
    nombre_fantasia: row.nombre_fantasia ?? '',
    domicilio: row.domicilio ?? '',
    localidad: row.localidad ?? '',
    provincia: row.provincia ?? '',
    contacto_nombre: row.contacto_nombre ?? '',
    contacto_email: row.contacto_email ?? '',
    contacto_telefono: row.contacto_telefono ?? '',
    industria: row.industria ?? '',
    art: row.art ?? '',
    notas: row.notas ?? '',
  };
}

/** Omite keys con `''` antes de invocar createClienteAction. */
function stripEmpty(values: ClienteFormValues): Record<string, string> {
  const out: Record<string, string> = {
    razon_social: values.razon_social,
    cuit: values.cuit,
  };
  for (const k of OPTIONAL_KEYS) {
    const v = values[k];
    if (v !== '') out[k] = v;
  }
  return out;
}

/**
 * Construye patch comparando values vs initial. Fields opcionales que pasaron
 * de "tenía valor" a `''` se envían como `null` (T-048 schema permite
 * `.nullable()`). Si no hay diff, retorna `null` (caller muestra toast info).
 */
function diffPatch(
  initial: ClienteFormValues,
  values: ClienteFormValues,
): Record<string, string | null> | null {
  const patch: Record<string, string | null> = {};

  if (values.razon_social !== initial.razon_social) {
    patch.razon_social = values.razon_social;
  }
  if (values.cuit !== initial.cuit) {
    patch.cuit = values.cuit;
  }

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
  | { mode: 'create'; initialValues?: never; clienteId?: never }
  | { mode: 'edit'; initialValues: ClienteRow; clienteId: string };

export function ClienteForm(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const initialFormValues =
    props.mode === 'edit' ? clienteRowToFormValues(props.initialValues) : EMPTY_DEFAULTS;

  const form = useForm<ClienteFormValues>({
    resolver: zodResolver(clienteFormSchema),
    defaultValues: initialFormValues,
  });

  function handleCuitBlur(currentValue: string, onBlur: () => void) {
    if (currentValue && CUIT_REGEX.test(currentValue)) {
      const normalized = normalizeCuit(currentValue);
      if (normalized !== currentValue) {
        form.setValue('cuit', normalized, { shouldDirty: true, shouldValidate: true });
      }
    }
    onBlur();
  }

  function onSubmit(values: ClienteFormValues) {
    if (props.mode === 'edit') {
      const patch = diffPatch(initialFormValues, values);
      if (patch === null) {
        toast.info('Sin cambios para guardar');
        return;
      }
      startTransition(async () => {
        const result = await updateClienteAction(props.clienteId, patch);
        handleResult(result, 'updated');
      });
      return;
    }

    const payload = stripEmpty(values);
    startTransition(async () => {
      const result = await createClienteAction(payload);
      handleResult(result, 'created');
    });
  }

  type ActionResult =
    | { ok: true; clienteId: string }
    | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

  function handleResult(result: ActionResult, verb: 'created' | 'updated') {
    if (result.ok) {
      toast.success(verb === 'created' ? 'Cliente creado' : 'Cambios guardados');
      router.push(`/clientes/${result.clienteId}`);
      router.refresh();
      return;
    }

    switch (result.code) {
      case 'INVALID_INPUT':
        if (result.fieldErrors) {
          for (const [field, msgs] of Object.entries(result.fieldErrors)) {
            const message = msgs[0];
            if (message && field in EMPTY_DEFAULTS) {
              form.setError(field as keyof ClienteFormValues, { message });
            }
          }
        }
        toast.error('Datos inválidos', { description: result.message });
        return;
      case 'DUPLICATE_CUIT':
        form.setError('cuit', {
          message: result.fieldErrors?.cuit?.[0] ?? 'CUIT duplicado.',
        });
        toast.error('CUIT duplicado', { description: result.message });
        return;
      case 'NOT_FOUND':
        toast.error('Cliente no encontrado');
        router.push('/clientes');
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: result.message });
        return;
      case 'BILLING_GATED':
        toast.error('Plan expirado', {
          description: result.message,
          action: { label: 'Suscribirme', onClick: () => router.push('/settings/billing') },
        });
        return;
      default:
        toast.error('Error inesperado', { description: result.message });
    }
  }

  const submitLabel =
    props.mode === 'create'
      ? isPending
        ? 'Creando…'
        : 'Crear cliente'
      : isPending
        ? 'Guardando…'
        : 'Guardar cambios';

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6" noValidate>
        {/* SECCIÓN 1: Identificación */}
        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Identificación
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="razon_social"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Razón social *</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme S.A." {...field} disabled={isPending} />
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
                  <FormLabel>CUIT *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="30-12345678-9"
                      {...field}
                      disabled={isPending}
                      onBlur={() => handleCuitBlur(field.value, field.onBlur)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="nombre_fantasia"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre fantasía</FormLabel>
                  <FormControl>
                    <Input placeholder="El Galpón" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <Separator />

        {/* SECCIÓN 2: Ubicación */}
        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Ubicación
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="domicilio"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Domicilio</FormLabel>
                  <FormControl>
                    <Input placeholder="Av. Siempre Viva 1234" {...field} disabled={isPending} />
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
                    <Input placeholder="San Justo" {...field} disabled={isPending} />
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
                  <Select
                    onValueChange={field.onChange}
                    value={field.value || undefined}
                    disabled={isPending}
                  >
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

        {/* SECCIÓN 3: Contacto */}
        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Contacto
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="contacto_nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input placeholder="Juan Pérez" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contacto_email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="contacto@acme.com.ar"
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
              name="contacto_telefono"
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

        {/* SECCIÓN 4: Detalles */}
        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Detalles
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="industria"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Industria</FormLabel>
                  <FormControl>
                    <Input placeholder="Industria metalúrgica" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="art"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ART</FormLabel>
                  <FormControl>
                    <Input placeholder="Provincia ART" {...field} disabled={isPending} />
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
