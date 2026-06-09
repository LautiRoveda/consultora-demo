'use client';

import type { ReactNode } from 'react';
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
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';

import { addSectionAction, updateSectionAction } from '../actions';
import { handleCommonFailure } from './feedback';

const sectionFormSchema = z.object({
  titulo: z
    .string()
    .trim()
    .min(1, { message: 'Mínimo 1 carácter.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),
  descripcion: optionalString({ max: 2000, label: 'descripción' }),
});

type SectionFormValues = z.infer<typeof sectionFormSchema>;

type Props =
  | { mode: 'create'; versionId: string; trigger: ReactNode }
  | {
      mode: 'edit';
      sectionId: string;
      initialValues: { titulo: string; descripcion: string | null };
      trigger: ReactNode;
    };

export function SectionEditDialog(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const initialFormValues: SectionFormValues =
    props.mode === 'edit'
      ? { titulo: props.initialValues.titulo, descripcion: props.initialValues.descripcion ?? '' }
      : { titulo: '', descripcion: '' };

  const form = useForm<SectionFormValues>({
    resolver: zodResolver(sectionFormSchema),
    defaultValues: initialFormValues,
  });

  function onSubmit(values: SectionFormValues) {
    let patch: Record<string, unknown> | null = null;
    if (props.mode === 'edit') {
      patch = buildSectionPatch(props.sectionId, props.initialValues, values);
      if (Object.keys(patch).length <= 1) {
        toast.info('Sin cambios para guardar');
        return;
      }
    }

    startTransition(async () => {
      const result =
        props.mode === 'create'
          ? await addSectionAction({
              versionId: props.versionId,
              titulo: values.titulo,
              ...(values.descripcion !== '' ? { descripcion: values.descripcion } : {}),
            })
          : await updateSectionAction(patch!);

      if (result.ok) {
        toast.success(props.mode === 'create' ? 'Sección agregada' : 'Sección actualizada');
        setOpen(false);
        router.refresh();
        return;
      }

      if (result.code === 'INVALID_INPUT') {
        for (const [field, msgs] of Object.entries(result.fieldErrors)) {
          const msg = msgs[0];
          if (msg && (field === 'titulo' || field === 'descripcion')) {
            form.setError(field, { message: msg });
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
          <DialogTitle>
            {props.mode === 'create' ? 'Agregar sección' : 'Editar sección'}
          </DialogTitle>
          <DialogDescription>
            Las secciones agrupan los ítems del checklist (ej: «Instalación eléctrica»).
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
              name="titulo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título *</FormLabel>
                  <FormControl>
                    <Input placeholder="Instalación eléctrica" {...field} disabled={isPending} />
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
                    <Textarea rows={2} placeholder="Opcional" {...field} disabled={isPending} />
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

function buildSectionPatch(
  sectionId: string,
  initial: { titulo: string; descripcion: string | null },
  values: SectionFormValues,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { sectionId };
  if (values.titulo !== initial.titulo) patch.titulo = values.titulo;
  const initialDesc = initial.descripcion ?? '';
  if (values.descripcion !== initialDesc) {
    patch.descripcion = values.descripcion === '' ? null : values.descripcion;
  }
  return patch;
}
