'use client';

import type { ItemRow } from './queries';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { optionalString } from '@/shared/lib/zod-form-helpers';
import { Button } from '@/shared/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Separator } from '@/shared/ui/separator';
import { Switch } from '@/shared/ui/switch';
import { Textarea } from '@/shared/ui/textarea';

import { createItemAction, updateItemAction } from './actions';

const itemFormSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(2, { message: 'Mínimo 2 caracteres.' })
      .max(120, { message: 'Máximo 120 caracteres.' }),
    categoria_id: z.string().uuid({ message: 'Elegí una categoría.' }),
    vida_util_meses: z
      .number()
      .int({ message: 'Debe ser un número entero.' })
      .min(1, { message: 'Mínimo 1 mes.' })
      .max(60, { message: 'Máximo 60 meses.' }),
    es_descartable: z.boolean(),
    requiere_numero_serie: z.boolean(),
    marca_default: optionalString({ max: 80, label: 'marca' }),
    modelo_default: optionalString({ max: 80, label: 'modelo' }),
    normativa: optionalString({ max: 200, label: 'normativa' }),
    notas: z.string().trim().max(2000, { message: 'Máximo 2000 caracteres.' }),
  })
  .refine((v) => !(v.es_descartable && v.requiere_numero_serie), {
    message: 'Un EPP descartable no puede requerir número de serie.',
    path: ['requiere_numero_serie'],
  });

type ItemFormValues = z.infer<typeof itemFormSchema>;

const EMPTY_DEFAULTS: ItemFormValues = {
  nombre: '',
  categoria_id: '',
  vida_util_meses: 6,
  es_descartable: false,
  requiere_numero_serie: false,
  marca_default: '',
  modelo_default: '',
  normativa: '',
  notas: '',
};

const OPTIONAL_STRING_KEYS = ['marca_default', 'modelo_default', 'normativa', 'notas'] as const;

function rowToValues(row: ItemRow): ItemFormValues {
  return {
    nombre: row.nombre,
    categoria_id: row.categoria_id,
    vida_util_meses: row.vida_util_meses,
    es_descartable: row.es_descartable,
    requiere_numero_serie: row.requiere_numero_serie,
    marca_default: row.marca_default ?? '',
    modelo_default: row.modelo_default ?? '',
    normativa: row.normativa ?? '',
    notas: row.notas ?? '',
  };
}

function stripEmpty(values: ItemFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {
    nombre: values.nombre,
    categoria_id: values.categoria_id,
    vida_util_meses: values.vida_util_meses,
    es_descartable: values.es_descartable,
    requiere_numero_serie: values.requiere_numero_serie,
  };
  for (const k of OPTIONAL_STRING_KEYS) {
    const v = values[k];
    if (v !== '') out[k] = v;
  }
  return out;
}

function diffPatch(
  initial: ItemFormValues,
  values: ItemFormValues,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (values.nombre !== initial.nombre) patch.nombre = values.nombre;
  if (values.categoria_id !== initial.categoria_id) patch.categoria_id = values.categoria_id;
  if (values.vida_util_meses !== initial.vida_util_meses) {
    patch.vida_util_meses = values.vida_util_meses;
  }
  if (values.es_descartable !== initial.es_descartable) {
    patch.es_descartable = values.es_descartable;
  }
  if (values.requiere_numero_serie !== initial.requiere_numero_serie) {
    patch.requiere_numero_serie = values.requiere_numero_serie;
  }
  for (const k of OPTIONAL_STRING_KEYS) {
    const initVal = initial[k];
    const newVal = values[k];
    if (initVal === newVal) continue;
    patch[k] = newVal === '' ? null : newVal;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

type CategoriaOption = { id: string; nombre: string };

type Props =
  | {
      mode: 'create';
      categorias: CategoriaOption[];
      initialValues?: never;
      itemId?: never;
    }
  | {
      mode: 'edit';
      categorias: CategoriaOption[];
      initialValues: ItemRow;
      itemId: string;
    };

export function ItemForm(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const initialFormValues =
    props.mode === 'edit' ? rowToValues(props.initialValues) : EMPTY_DEFAULTS;

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: initialFormValues,
  });

  const esDescartable = useWatch({ control: form.control, name: 'es_descartable' });
  const requiereSerie = useWatch({ control: form.control, name: 'requiere_numero_serie' });

  type ActionResult =
    | { ok: true; id: string }
    | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

  function handleResult(result: ActionResult, verb: 'created' | 'updated') {
    if (result.ok) {
      toast.success(verb === 'created' ? 'Item creado' : 'Cambios guardados');
      router.push('/epp/catalogo/items');
      router.refresh();
      return;
    }

    switch (result.code) {
      case 'INVALID_INPUT':
        if (result.fieldErrors) {
          for (const [field, msgs] of Object.entries(result.fieldErrors)) {
            const msg = msgs[0];
            if (msg && field in EMPTY_DEFAULTS) {
              form.setError(field as keyof ItemFormValues, { message: msg });
            }
          }
        }
        toast.error('Datos inválidos', { description: result.message });
        return;
      case 'FORBIDDEN_NOT_OWNER':
        toast.error('Permisos insuficientes', { description: result.message });
        return;
      case 'NOT_FOUND':
        toast.error('Item no encontrado');
        router.push('/epp/catalogo/items');
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

  function onSubmit(values: ItemFormValues) {
    if (props.mode === 'edit') {
      const patch = diffPatch(initialFormValues, values);
      if (patch === null) {
        toast.info('Sin cambios para guardar');
        return;
      }
      startTransition(async () => {
        const result = await updateItemAction(props.itemId, patch);
        handleResult(result, 'updated');
      });
      return;
    }
    const payload = stripEmpty(values);
    startTransition(async () => {
      const result = await createItemAction(payload);
      handleResult(result, 'created');
    });
  }

  const submitLabel =
    props.mode === 'create'
      ? isPending
        ? 'Creando…'
        : 'Crear item'
      : isPending
        ? 'Guardando…'
        : 'Guardar cambios';

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6" noValidate>
        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Identificación
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Nombre *</FormLabel>
                  <FormControl>
                    <Input placeholder="Casco clase A" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="categoria_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value || undefined}
                    disabled={isPending || props.categorias.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            props.categorias.length === 0
                              ? 'Creá una categoría primero'
                              : 'Elegí una categoría'
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {props.categorias.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nombre}
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
              name="vida_util_meses"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vida útil (meses) *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      step={1}
                      name={field.name}
                      ref={field.ref}
                      value={Number.isFinite(field.value) ? field.value : ''}
                      onBlur={field.onBlur}
                      onChange={(e) => {
                        const v = e.target.value;
                        field.onChange(v === '' ? Number.NaN : Number(v));
                      }}
                      disabled={isPending || esDescartable}
                    />
                  </FormControl>
                  {esDescartable && (
                    <p className="text-muted-foreground text-xs">
                      No aplica para EPP descartable — el sistema no genera planificación de
                      renovación.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Tipo de EPP
          </h3>
          <FormField
            control={form.control}
            name="es_descartable"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel>Descartable</FormLabel>
                  <p className="text-muted-foreground text-xs">
                    Guantes nitrilo, antiparras transparentes, barbijo N95… El sistema no genera
                    planificación de renovación 6m.
                  </p>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      if (checked && requiereSerie) {
                        form.setValue('requiere_numero_serie', false, { shouldValidate: true });
                      }
                    }}
                    disabled={isPending}
                    aria-label="Toggle descartable"
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="requiere_numero_serie"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel>Requiere número de serie</FormLabel>
                  <p className="text-muted-foreground text-xs">
                    Arnés, línea de vida retráctil… Cada entrega va a exigir el número de serie del
                    producto físico.
                  </p>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isPending || esDescartable}
                    aria-label="Toggle requiere número de serie"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <Separator />

        <section className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            Marca / modelo / normativa
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="marca_default"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Marca default</FormLabel>
                  <FormControl>
                    <Input placeholder="3M, MSA, Libus…" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="modelo_default"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Modelo default</FormLabel>
                  <FormControl>
                    <Input placeholder="V-Gard, H-700…" {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="normativa"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Normativa</FormLabel>
                  <FormControl>
                    <Input placeholder="IRAM 3620, NIOSH N95…" {...field} disabled={isPending} />
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
                      rows={3}
                      placeholder="Notas para tu equipo…"
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
