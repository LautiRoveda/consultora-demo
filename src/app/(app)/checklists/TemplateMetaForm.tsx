'use client';

import type { TipoInspeccion } from './schema';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';

import { createChecklistTemplateAction, updateTemplateMetaAction } from './actions';
import { TIPO_INSPECCION_LABELS } from './labels';
import { TIPO_INSPECCION_VALUES } from './schema';

const metaFormSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),
  descripcion: optionalString({ max: 2000, label: 'descripción' }),
  tipo_inspeccion: z.enum(TIPO_INSPECCION_VALUES, { message: 'Tipo inválido.' }),
});

type MetaFormValues = z.infer<typeof metaFormSchema>;

const EMPTY_DEFAULTS: MetaFormValues = {
  nombre: '',
  descripcion: '',
  tipo_inspeccion: 'rgrl_463_09',
};

type EditInitial = { nombre: string; descripcion: string | null; tipo_inspeccion: TipoInspeccion };

type Props =
  | { mode: 'create'; onSaved?: never; templateId?: never; initialValues?: never }
  | { mode: 'edit'; templateId: string; initialValues: EditInitial; onSaved?: () => void };

export function TemplateMetaForm(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const initialFormValues: MetaFormValues =
    props.mode === 'edit'
      ? {
          nombre: props.initialValues.nombre,
          descripcion: props.initialValues.descripcion ?? '',
          tipo_inspeccion: props.initialValues.tipo_inspeccion,
        }
      : EMPTY_DEFAULTS;

  const form = useForm<MetaFormValues>({
    resolver: zodResolver(metaFormSchema),
    defaultValues: initialFormValues,
  });

  type ActionResult =
    | { ok: true; templateId: string }
    | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

  function handleResult(result: ActionResult) {
    if (result.ok) {
      if (props.mode === 'create') {
        toast.success('Template creado');
        router.push(`/checklists/${result.templateId}`);
        router.refresh();
      } else {
        toast.success('Cambios guardados');
        props.onSaved?.();
        router.refresh();
      }
      return;
    }

    switch (result.code) {
      case 'INVALID_INPUT':
        if (result.fieldErrors) {
          for (const [field, msgs] of Object.entries(result.fieldErrors)) {
            const msg = msgs[0];
            if (msg && field in EMPTY_DEFAULTS) {
              form.setError(field as keyof MetaFormValues, { message: msg });
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
      case 'NOT_FOUND':
        toast.error('Template no encontrado');
        router.refresh();
        return;
      case 'FORBIDDEN_NOT_OWNER':
        toast.error('Permisos insuficientes', { description: result.message });
        return;
      case 'BILLING_GATED':
        toast.error('Suscripción requerida', { description: result.message });
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      default:
        toast.error('Error inesperado', { description: result.message });
    }
  }

  function onSubmit(values: MetaFormValues) {
    if (props.mode === 'edit') {
      const patch: Record<string, unknown> = { templateId: props.templateId };
      let changed = false;
      if (values.nombre !== props.initialValues.nombre) {
        patch.nombre = values.nombre;
        changed = true;
      }
      const initialDesc = props.initialValues.descripcion ?? '';
      if (values.descripcion !== initialDesc) {
        patch.descripcion = values.descripcion === '' ? null : values.descripcion;
        changed = true;
      }
      if (values.tipo_inspeccion !== props.initialValues.tipo_inspeccion) {
        patch.tipo_inspeccion = values.tipo_inspeccion;
        changed = true;
      }
      if (!changed) {
        toast.info('Sin cambios para guardar');
        return;
      }
      startTransition(async () => {
        const result = await updateTemplateMetaAction(patch);
        handleResult(result);
      });
      return;
    }

    const payload: Record<string, unknown> = {
      nombre: values.nombre,
      tipo_inspeccion: values.tipo_inspeccion,
    };
    if (values.descripcion !== '') payload.descripcion = values.descripcion;
    startTransition(async () => {
      const result = await createChecklistTemplateAction(payload);
      handleResult(result);
    });
  }

  const submitLabel =
    props.mode === 'create'
      ? isPending
        ? 'Creando…'
        : 'Crear template'
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
                <Input placeholder="RGRL planta norte" {...field} disabled={isPending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="tipo_inspeccion"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo de inspección *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} disabled={isPending}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí un tipo" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TIPO_INSPECCION_VALUES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {TIPO_INSPECCION_LABELS[v]}
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
          name="descripcion"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="Para qué sirve este checklist…"
                  {...field}
                  disabled={isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          {props.mode === 'edit' ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => props.onSaved?.()}
              disabled={isPending}
            >
              Cancelar
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.back()}
              disabled={isPending}
            >
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={isPending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
