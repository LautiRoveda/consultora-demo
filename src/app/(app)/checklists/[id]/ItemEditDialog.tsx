'use client';

import type { ReactNode } from 'react';
import type { ResponseType } from '../schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { optionalString } from '@/shared/lib/zod-form-helpers';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';
import { Textarea } from '@/shared/ui/textarea';

import { addItemAction, updateItemAction } from '../actions';
import { RESPONSE_TYPE_LABELS } from '../labels';
import { RESPONSE_TYPE_VALUES } from '../schema';
import { handleCommonFailure } from './feedback';

const itemFormSchema = z.object({
  texto: z
    .string()
    .trim()
    .min(1, { message: 'Mínimo 1 carácter.' })
    .max(1000, { message: 'Máximo 1000 caracteres.' }),
  response_type: z.enum(RESPONSE_TYPE_VALUES, { message: 'Tipo de respuesta inválido.' }),
  es_critico: z.boolean(),
  es_requerido: z.boolean(),
  referencia_normativa: optionalString({ max: 300, label: 'referencia normativa' }),
});

type ItemFormValues = z.infer<typeof itemFormSchema>;

type ItemInitial = {
  texto: string;
  response_type: ResponseType;
  es_critico: boolean;
  es_requerido: boolean;
  referencia_normativa: string | null;
};

const CREATE_DEFAULTS: ItemFormValues = {
  texto: '',
  response_type: 'cumple_no_aplica',
  es_critico: false,
  es_requerido: true,
  referencia_normativa: '',
};

type Props =
  | { mode: 'create'; sectionId: string; trigger: ReactNode }
  | { mode: 'edit'; itemId: string; initialValues: ItemInitial; trigger: ReactNode };

export function ItemEditDialog(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const initialFormValues: ItemFormValues =
    props.mode === 'edit'
      ? {
          texto: props.initialValues.texto,
          response_type: props.initialValues.response_type,
          es_critico: props.initialValues.es_critico,
          es_requerido: props.initialValues.es_requerido,
          referencia_normativa: props.initialValues.referencia_normativa ?? '',
        }
      : CREATE_DEFAULTS;

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: initialFormValues,
  });

  function onSubmit(values: ItemFormValues) {
    let patch: Record<string, unknown> | null = null;
    if (props.mode === 'edit') {
      patch = buildItemPatch(props.itemId, props.initialValues, values);
      if (Object.keys(patch).length <= 1) {
        toast.info('Sin cambios para guardar');
        return;
      }
    }

    startTransition(async () => {
      const result =
        props.mode === 'create'
          ? await addItemAction({
              sectionId: props.sectionId,
              texto: values.texto,
              response_type: values.response_type,
              es_critico: values.es_critico,
              es_requerido: values.es_requerido,
              ...(values.referencia_normativa !== ''
                ? { referencia_normativa: values.referencia_normativa }
                : {}),
            })
          : await updateItemAction(patch!);

      if (result.ok) {
        toast.success(props.mode === 'create' ? 'Ítem agregado' : 'Ítem actualizado');
        setOpen(false);
        router.refresh();
        return;
      }

      if (result.code === 'INVALID_INPUT') {
        for (const [field, msgs] of Object.entries(result.fieldErrors)) {
          const msg = msgs[0];
          if (msg && field in CREATE_DEFAULTS) {
            form.setError(field as keyof ItemFormValues, { message: msg });
          }
        }
        toast.error('Datos inválidos', { description: result.message });
        return;
      }

      setOpen(false);
      handleCommonFailure(result, router);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(initialFormValues);
      }}
    >
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.mode === 'create' ? 'Agregar ítem' : 'Editar ítem'}</DialogTitle>
          <DialogDescription>
            Un ítem es una verificación del checklist (qué se inspecciona y cómo se responde).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="texto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Texto del ítem *</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="¿Los tableros eléctricos están señalizados?"
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
              name="response_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de respuesta *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={isPending}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí un tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {RESPONSE_TYPE_VALUES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {RESPONSE_TYPE_LABELS[v]}
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
              name="es_critico"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Crítico</FormLabel>
                    <p className="text-muted-foreground text-xs">
                      Un incumplimiento crítico marca el checklist como no conforme.
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isPending}
                      aria-label="Marcar ítem como crítico"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="es_requerido"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Requerido</FormLabel>
                    <p className="text-muted-foreground text-xs">
                      Hay que responderlo para poder cerrar la ejecución.
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isPending}
                      aria-label="Marcar ítem como requerido"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="referencia_normativa"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Referencia normativa</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Dec. 351/79 art. 95"
                      {...field}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Guardando…' : props.mode === 'create' ? 'Agregar' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function buildItemPatch(
  itemId: string,
  initial: ItemInitial,
  values: ItemFormValues,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { itemId };
  if (values.texto !== initial.texto) patch.texto = values.texto;
  if (values.response_type !== initial.response_type) patch.response_type = values.response_type;
  if (values.es_critico !== initial.es_critico) patch.es_critico = values.es_critico;
  if (values.es_requerido !== initial.es_requerido) patch.es_requerido = values.es_requerido;
  const initialRef = initial.referencia_normativa ?? '';
  if (values.referencia_normativa !== initialRef) {
    patch.referencia_normativa =
      values.referencia_normativa === '' ? null : values.referencia_normativa;
  }
  return patch;
}
