'use client';

import type { SignaturePadHandle } from '@/shared/ui/signature-pad';
import type { ItemCatalogOption } from './EntregaItemsBuilder';
import type { CreateEntregaInput } from './schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { SignaturePad } from '@/shared/ui/signature-pad';
import { Textarea } from '@/shared/ui/textarea';

import { createEntregaAction } from './actions';
import { EntregaItemsBuilder } from './EntregaItemsBuilder';
import { createEntregaSchema, DEFAULT_MOTIVO_ENTREGA } from './schema';

type WizardStep = 'empleado' | 'items' | 'firma';

export type EmpleadoOption = {
  id: string;
  nombre: string;
  apellido: string;
  dni: string | null;
  cliente_id: string;
  cliente_razon_social: string;
};

export type EntregaWizardProps = {
  empleados: EmpleadoOption[];
  items: ItemCatalogOption[];
  /**
   * T-106 · Preselect desde sugerencia IA (`?empleado=<id>&items=<csv>`).
   * El server page resuelve los query params, valida UUID + scope al
   * catálogo/empleados disponibles, y pasa los ya-filtrados. Si el set queda
   * vacío, los props llegan undefined y el wizard arranca como siempre.
   */
  initialEmpleadoId?: string;
  initialItemIds?: string[];
};

const STEP_TITLES: Record<WizardStep, string> = {
  empleado: '1. Empleado',
  items: '2. Items EPP entregados',
  firma: '3. Firma del operario',
};

export function EntregaWizard({
  empleados,
  items,
  initialEmpleadoId,
  initialItemIds,
}: EntregaWizardProps) {
  const router = useRouter();
  // Preselect IA: si hay empleado válido + items, arrancar en step 'items'
  // (el consultor ya validó la selección en el padrón). Si solo viene
  // empleado, igual saltamos a items porque el step 1 quedaría vacío y
  // confuso (el select aparece resuelto).
  const initialStep: WizardStep = initialEmpleadoId ? 'items' : 'empleado';
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [isPending, setIsPending] = useState(false);
  const [firmaIsEmpty, setFirmaIsEmpty] = useState(true);
  const padRef = useRef<SignaturePadHandle>(null);

  const form = useForm<CreateEntregaInput>({
    resolver: zodResolver(createEntregaSchema),
    defaultValues: {
      empleado_id: initialEmpleadoId ?? '',
      items:
        initialItemIds?.map((id) => ({
          item_id: id,
          cantidad: 1,
          motivo_entrega: DEFAULT_MOTIVO_ENTREGA,
        })) ?? [],
      firma_base64: '',
      observaciones: '',
    },
    mode: 'onBlur',
  });

  const itemsFieldArray = useFieldArray({
    control: form.control,
    name: 'items',
  });

  const empleadosById = useMemo(() => {
    const map = new Map<string, EmpleadoOption>();
    empleados.forEach((e) => map.set(e.id, e));
    return map;
  }, [empleados]);

  const selectedEmpleadoId = useWatch({ control: form.control, name: 'empleado_id' });
  const selectedEmpleado = selectedEmpleadoId ? empleadosById.get(selectedEmpleadoId) : undefined;

  async function handleNext() {
    if (step === 'empleado') {
      const ok = await form.trigger(['empleado_id']);
      if (ok) setStep('items');
      return;
    }
    if (step === 'items') {
      const ok = await form.trigger(['items']);
      if (!ok) return;
      // Pre-check: validar manualmente que cada item con requiere_numero_serie
      // tenga numero_serie. El submit final también lo valida server-side, pero
      // sacar al user del step de firma con error de items es mala UX.
      const values = form.getValues('items');
      const itemsById = new Map(items.map((i) => [i.id, i]));
      let hasSerialError = false;
      values.forEach((row, idx) => {
        const catalog = itemsById.get(row.item_id);
        if (catalog?.requiere_numero_serie) {
          const ns = (row.numero_serie ?? '').trim();
          if (ns.length === 0) {
            form.setError(`items.${idx}.numero_serie`, {
              type: 'manual',
              message: 'Este item requiere número de serie.',
            });
            hasSerialError = true;
          }
        }
      });
      if (hasSerialError) return;
      setStep('firma');
    }
  }

  function handleBack() {
    if (step === 'items') setStep('empleado');
    else if (step === 'firma') setStep('items');
  }

  function handleClearFirma() {
    padRef.current?.clear();
    setFirmaIsEmpty(true);
    form.setValue('firma_base64', '');
  }

  async function handleSubmit() {
    if (firmaIsEmpty) {
      toast.error('Falta firmar', { description: 'Necesitamos la firma del operario.' });
      return;
    }
    const dataUrl = padRef.current?.toDataURL() ?? '';
    form.setValue('firma_base64', dataUrl);
    const ok = await form.trigger();
    if (!ok) {
      toast.error('Hay datos inválidos', {
        description: 'Revisá los campos marcados en rojo.',
      });
      return;
    }

    setIsPending(true);
    const values = form.getValues();
    const result = await createEntregaAction(values);

    if (result.ok) {
      if (result.planificacionWarning) {
        toast.info('Entrega firmada', { description: result.planificacionWarning });
      } else {
        toast.success('Entrega registrada', {
          description: 'Firma guardada y planificación 6m generada.',
        });
      }
      router.push(`/epp/entregas/${result.entregaId}`);
      router.refresh();
      return;
    }

    setIsPending(false);

    if (result.code === 'INVALID_INPUT') {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (field.startsWith('items.') || field === 'empleado_id' || field === 'firma_base64') {
          // RHF acepta paths con dot notation
          form.setError(field as Parameters<typeof form.setError>[0], {
            message: messages[0],
          });
        }
      }
      toast.error('Revisá los datos', { description: result.message });
      // Volver al step relevante.
      const firstError = Object.keys(result.fieldErrors)[0] ?? '';
      if (firstError === 'empleado_id') setStep('empleado');
      else if (firstError.startsWith('items.')) setStep('items');
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
      case 'FORBIDDEN_NOT_OWNER':
        toast.error('Acción reservada al titular', { description: result.message });
        return;
      case 'EMPLEADO_NOT_FOUND':
        toast.error('Empleado inválido', { description: result.message });
        setStep('empleado');
        return;
      case 'ITEM_NOT_FOUND':
        toast.error('Item inválido', { description: result.message });
        setStep('items');
        return;
      case 'STORAGE_ERROR':
        toast.error('No se guardó la firma', { description: result.message });
        return;
      case 'INTERNAL_ERROR':
        toast.error('Error inesperado', { description: result.message });
        return;
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardContent className="grid gap-6 pt-6">
        <header className="flex items-center justify-between gap-2">
          {/* min-w-0 deja que el titulo trunque si es largo; shrink-0 evita que "Paso X de 3"
              se comprima a 2 lineas en mobile. */}
          <h2 className="min-w-0 text-lg font-semibold">{STEP_TITLES[step]}</h2>
          <div className="shrink-0 text-xs text-muted-foreground">Paso {stepIndex(step)} de 3</div>
        </header>

        <Form {...form}>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            {step === 'empleado' && (
              <>
                <FormField
                  control={form.control}
                  name="empleado_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Empleado</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Elegí un empleado" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {empleados.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.apellido}, {e.nombre}
                              {e.dni ? ` · DNI ${e.dni}` : ''} — {e.cliente_razon_social}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {selectedEmpleado && (
                  <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm">
                    <div className="font-medium">Cliente asociado</div>
                    <div className="text-muted-foreground">
                      {selectedEmpleado.cliente_razon_social}
                    </div>
                  </div>
                )}
              </>
            )}

            {step === 'items' && (
              <EntregaItemsBuilder form={form} fieldArray={itemsFieldArray} itemsCatalog={items} />
            )}

            {step === 'firma' && (
              <div className="grid gap-3">
                <FormField
                  control={form.control}
                  name="observaciones"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Observaciones <span className="text-muted-foreground">(opcional)</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          value={field.value ?? ''}
                          rows={3}
                          placeholder="Notas operativas para el historial."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-2">
                  <FormLabel>Firma del operario</FormLabel>
                  <SignaturePad
                    ref={padRef}
                    onChange={(empty) => setFirmaIsEmpty(empty)}
                    ariaLabel="Pad de firma del operario para la entrega EPP"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      El empleado firma con el dedo (mobile) o el mouse.
                    </p>
                    <Button type="button" variant="ghost" size="sm" onClick={handleClearFirma}>
                      Limpiar
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* En mobile la barra apila full-width (Volver arriba, accion principal abajo);
                en desktop vuelve a fila con Volver a la izquierda y la accion a la derecha. */}
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {step !== 'empleado' && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    disabled={isPending}
                    className="w-full sm:w-auto"
                  >
                    ← Volver
                  </Button>
                )}
              </div>

              <div className="flex gap-2">
                {step !== 'firma' ? (
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      void handleNext();
                    }}
                  >
                    Siguiente →
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={isPending || firmaIsEmpty}
                    className="w-full sm:w-auto"
                  >
                    {isPending ? 'Registrando…' : 'Registrar entrega'}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function stepIndex(step: WizardStep): number {
  return step === 'empleado' ? 1 : step === 'items' ? 2 : 3;
}
