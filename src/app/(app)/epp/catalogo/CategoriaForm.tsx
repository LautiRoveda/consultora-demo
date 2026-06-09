'use client';

import type { CategoriaRow } from './queries';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { optionalString } from '@/shared/lib/zod-form-helpers';
import { Button } from '@/shared/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';

import { createCategoriaAction, updateCategoriaAction } from './actions';

const categoriaFormSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(80, { message: 'Máximo 80 caracteres.' }),
  descripcion: optionalString({ max: 500, label: 'descripción' }),
});

type CategoriaFormValues = z.infer<typeof categoriaFormSchema>;

const EMPTY_DEFAULTS: CategoriaFormValues = { nombre: '', descripcion: '' };

function rowToValues(row: CategoriaRow): CategoriaFormValues {
  return {
    nombre: row.nombre,
    descripcion: row.descripcion ?? '',
  };
}

function stripEmpty(values: CategoriaFormValues): Record<string, string> {
  const out: Record<string, string> = { nombre: values.nombre };
  if (values.descripcion !== '') out.descripcion = values.descripcion;
  return out;
}

function diffPatch(
  initial: CategoriaFormValues,
  values: CategoriaFormValues,
): Record<string, string | null> | null {
  const patch: Record<string, string | null> = {};
  if (values.nombre !== initial.nombre) patch.nombre = values.nombre;
  if (values.descripcion !== initial.descripcion) {
    patch.descripcion = values.descripcion === '' ? null : values.descripcion;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

type Props =
  | { mode: 'create'; initialValues?: never; categoriaId?: never }
  | { mode: 'edit'; initialValues: CategoriaRow; categoriaId: string };

export function CategoriaForm(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const initialFormValues =
    props.mode === 'edit' ? rowToValues(props.initialValues) : EMPTY_DEFAULTS;

  const form = useForm<CategoriaFormValues>({
    resolver: zodResolver(categoriaFormSchema),
    defaultValues: initialFormValues,
  });

  type ActionResult =
    | { ok: true; id: string }
    | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

  function handleResult(result: ActionResult, verb: 'created' | 'updated') {
    if (result.ok) {
      toast.success(verb === 'created' ? 'Categoría creada' : 'Cambios guardados');
      router.push('/epp/catalogo/categorias');
      router.refresh();
      return;
    }

    switch (result.code) {
      case 'INVALID_INPUT':
        if (result.fieldErrors) {
          for (const [field, msgs] of Object.entries(result.fieldErrors)) {
            const msg = msgs[0];
            if (msg && field in EMPTY_DEFAULTS) {
              form.setError(field as keyof CategoriaFormValues, { message: msg });
            }
          }
        }
        toast.error('Datos inválidos', { description: result.message });
        return;
      case 'DUPLICATE_NAME':
        form.setError('nombre', {
          message: result.fieldErrors?.nombre?.[0] ?? 'Nombre duplicado.',
        });
        toast.error('Nombre duplicado', { description: result.message });
        return;
      case 'FORBIDDEN_NOT_OWNER':
        toast.error('Permisos insuficientes', { description: result.message });
        return;
      case 'NOT_FOUND':
        toast.error('Categoría no encontrada');
        router.push('/epp/catalogo/categorias');
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

  function onSubmit(values: CategoriaFormValues) {
    if (props.mode === 'edit') {
      const patch = diffPatch(initialFormValues, values);
      if (patch === null) {
        toast.info('Sin cambios para guardar');
        return;
      }
      startTransition(async () => {
        const result = await updateCategoriaAction(props.categoriaId, patch);
        handleResult(result, 'updated');
      });
      return;
    }
    const payload = stripEmpty(values);
    startTransition(async () => {
      const result = await createCategoriaAction(payload);
      handleResult(result, 'created');
    });
  }

  const submitLabel =
    props.mode === 'create'
      ? isPending
        ? 'Creando…'
        : 'Crear categoría'
      : isPending
        ? 'Guardando…'
        : 'Guardar cambios';

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6" noValidate>
        <FormField
          control={form.control}
          name="nombre"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre *</FormLabel>
              <FormControl>
                <Input placeholder="Protección anti-corte" {...field} disabled={isPending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="descripcion"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="EPP especializado para tareas con riesgo de corte"
                  {...field}
                  disabled={isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
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
