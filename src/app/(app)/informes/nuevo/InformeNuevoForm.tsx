'use client';

import type { RgrlMetadata } from '@/shared/templates/rgrl/schema';
import type { CreateInformeInput } from '../schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { rgrlMetadataDefaults, RgrlMetadataForm } from '@/shared/templates/rgrl/RgrlMetadataForm';
import { rgrlMetadataSchema } from '@/shared/templates/rgrl/schema';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { createInformeAction } from '../actions';
import { createInformeSchema, INFORME_TIPO_LABELS, INFORME_TIPOS } from '../schema';

/**
 * T-021 · Wizard de creacion de informes (2 steps).
 *
 * Step `'tipo'`: tipo + titulo (espejo de T-019).
 *   - Si `tipo === 'rgrl'`, el boton principal dice "Siguiente" y avanza al
 *     step `'metadata'`.
 *   - Si `tipo !== 'rgrl'`, el boton dice "Crear informe" y submit directo.
 *
 * Step `'metadata'`: form RGRL completo.
 *   - "← Volver" preserva los values del metadataForm.
 *   - "Crear sin datos" abre un AlertDialog de confirmacion → submit sin metadata.
 *   - "Crear informe con datos" valida step 2 + submit con metadata.
 *
 * Si el user vuelve a step 1 y cambia tipo a !== 'rgrl', descartamos
 * metadataForm silenciosamente (devLog console.log en NODE_ENV=development).
 */

type WizardStep = 'tipo' | 'metadata';

export function InformeNuevoForm() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>('tipo');
  const [isPending, setIsPending] = useState(false);

  const baseForm = useForm<CreateInformeInput>({
    resolver: zodResolver(createInformeSchema),
    defaultValues: { tipo: 'relevamiento', titulo: '' },
  });

  const metadataForm = useForm<RgrlMetadata>({
    resolver: zodResolver(rgrlMetadataSchema),
    defaultValues: rgrlMetadataDefaults(),
  });

  // eslint-disable-next-line react-hooks/incompatible-library
  const tipoWatch = baseForm.watch('tipo');
  const isRgrl = tipoWatch === 'rgrl';

  // Si el user vuelve a step 1 y cambia tipo !== rgrl, reset metadataForm.
  useEffect(() => {
    if (step === 'tipo' && tipoWatch !== 'rgrl' && metadataForm.formState.isDirty) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[wizard] tipo cambio a', tipoWatch, '— descartando metadataForm');
      }
      metadataForm.reset(rgrlMetadataDefaults());
    }
  }, [step, tipoWatch, metadataForm]);

  /**
   * Submit a `createInformeAction` con o sin metadata. Maneja errores con
   * pattern match sobre el discriminated union.
   */
  async function submitWithMetadata(metadata: RgrlMetadata | undefined) {
    setIsPending(true);
    const values = baseForm.getValues();
    const result = await createInformeAction({ ...values, metadata });

    if (result.ok) {
      if (metadata && !result.metadataPersisted) {
        toast.warning('Informe creado, pero no se guardaron los datos', {
          description: 'Completalos otra vez desde el editor.',
        });
      } else {
        toast.success('Informe creado');
      }
      router.push(result.redirectTo);
      router.refresh();
      return;
    }

    setIsPending(false);

    if (result.code === 'INVALID_INPUT') {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (field === 'tipo' || field === 'titulo') {
          baseForm.setError(field, { message: messages[0] });
        }
      }
      // Si el error vino del step 2, volver a step 1 para mostrarlo.
      setStep('tipo');
      toast.error('Datos inválidos', { description: result.message });
      return;
    }

    switch (result.code) {
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: result.message });
        return;
      case 'INTERNAL_ERROR':
        toast.error('Error inesperado', { description: result.message });
        return;
    }
  }

  /** Step 1 submit handler. Si es RGRL → avanza al step 2; sino → submit. */
  async function onStep1Submit() {
    if (isRgrl) {
      setStep('metadata');
      return;
    }
    await submitWithMetadata(undefined);
  }

  /** Step 2 submit handler. Valida + envia con metadata. */
  async function onStep2Submit(values: RgrlMetadata) {
    await submitWithMetadata(values);
  }

  return (
    <Card className="max-w-3xl">
      <CardContent className="pt-6">
        {step === 'tipo' && (
          <Form {...baseForm}>
            <form
              onSubmit={(e) => void baseForm.handleSubmit(onStep1Submit)(e)}
              className="grid gap-4"
              noValidate
            >
              <FormField
                control={baseForm.control}
                name="tipo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de informe</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Elegí un tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {INFORME_TIPOS.map((tipo) => (
                          <SelectItem key={tipo} value={tipo}>
                            {INFORME_TIPO_LABELS[tipo]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={baseForm.control}
                name="titulo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Título</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Relevamiento de ruido — Planta Sur" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={isPending}>
                  {isRgrl ? 'Siguiente: cargar datos' : isPending ? 'Creando…' : 'Crear informe'}
                </Button>
              </div>
            </form>
          </Form>
        )}

        {step === 'metadata' && (
          <Form {...metadataForm}>
            <form
              onSubmit={(e) => void metadataForm.handleSubmit(onStep2Submit)(e)}
              className="space-y-6"
              noValidate
            >
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Datos del relevamiento</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Esta información se inyecta al prompt de la IA para que genere un borrador 80-90%
                  completo en lugar de placeholders.
                </p>
              </div>

              <RgrlMetadataForm form={metadataForm} disabled={isPending} />

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep('tipo')}
                  disabled={isPending}
                >
                  ← Volver
                </Button>

                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" disabled={isPending}>
                        Crear sin datos
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Crear sin datos?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Podés cargar los datos del establecimiento después desde el editor.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => void submitWithMetadata(undefined)}
                          disabled={isPending}
                        >
                          Crear vacío
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <Button type="submit" disabled={isPending}>
                    {isPending ? 'Creando…' : 'Crear informe con datos'}
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
