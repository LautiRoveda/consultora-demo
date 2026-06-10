'use client';

import type { ClienteSummary } from '@/app/(app)/clientes/queries';
import type { AccidenteMetadata } from '@/shared/templates/accidente/schema';
import type { CapacitacionMetadata } from '@/shared/templates/capacitacion/schema';
import type { OtrosMetadata } from '@/shared/templates/otros/schema';
import type { RelevamientoMetadata } from '@/shared/templates/relevamiento/schema';
import type { RgrlMetadata } from '@/shared/templates/rgrl/schema';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import type { PlantillaClientItem } from '../plantillas/PlantillaControls';
import type { CreateInformeInput, InformeTipo } from '../schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { accidenteMetadataDefaults } from '@/shared/templates/accidente/AccidenteMetadataForm';
import { accidenteMetadataSchema } from '@/shared/templates/accidente/schema';
import { capacitacionMetadataDefaults } from '@/shared/templates/capacitacion/CapacitacionMetadataForm';
import { capacitacionMetadataSchema } from '@/shared/templates/capacitacion/schema';
import { otrosMetadataDefaults } from '@/shared/templates/otros/OtrosMetadataForm';
import { otrosMetadataSchema } from '@/shared/templates/otros/schema';
import { TEMPLATE_CLIENT_REGISTRY } from '@/shared/templates/registry/client';
import { relevamientoMetadataDefaults } from '@/shared/templates/relevamiento/RelevamientoMetadataForm';
import { relevamientoMetadataSchema } from '@/shared/templates/relevamiento/schema';
import { rgrlMetadataDefaults } from '@/shared/templates/rgrl/RgrlMetadataForm';
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
import { PlantillaControls } from '../plantillas/PlantillaControls';
import { createInformeSchema, INFORME_TIPO_LABELS, INFORME_TIPOS } from '../schema';
import { mapClienteToFormValues } from './cliente-form-mapper';
import { ClienteAutocomplete } from './ClienteAutocomplete';

/**
 * T-021 · Wizard de creacion de informes (2 steps).
 * T-022 · Generalizado para los 5 tipos via `useFormsByTipo()` + el registry
 *         cliente. Cada tipo tiene su `useForm` instance dedicada que vive
 *         durante todo el ciclo de vida del wizard.
 *
 * Step `'tipo'`: tipo + titulo. Boton dice "Siguiente" para todos los tipos
 *   con metadata (los 5 hoy).
 * Step `'metadata'`: form del tipo activo, renderizado desde el registry.
 *   - "← Volver" preserva los values del form activo.
 *   - "Crear sin datos" abre AlertDialog de confirmacion → submit sin metadata.
 *   - "Crear con datos" valida step 2 + submit con metadata.
 *
 * COMENTARIO IMPORTANTE sobre useFormsByTipo:
 * Volver al mismo tipo previo PRESERVA los values ingresados — las 5
 * instancias `useForm` sobreviven al cambio de tipo (vivien durante todo el
 * mount del componente). Si necesitas reset entre tipos, usar
 * `form.reset(defaults)` explicito al cambio. Hoy NO reseteamos al cambiar
 * tipo: el user vuelve, ve sus datos y puede ajustar — UX preferida vs
 * "form siempre limpio segun tipo".
 */

type WizardStep = 'tipo' | 'metadata';

/** Titulo del step 2 por tipo (genero gramatical correcto). */
const STEP2_TITLE_BY_TIPO: Record<InformeTipo, string> = {
  rgrl: 'Datos del relevamiento',
  capacitacion: 'Datos de la capacitación',
  relevamiento: 'Datos del relevamiento',
  accidente: 'Datos del accidente',
  otros: 'Datos del informe',
};

// Map de tipo → metadata específico. Usado por TS para narrowear forms[tipo].
type MetadataByTipo = {
  rgrl: RgrlMetadata;
  capacitacion: CapacitacionMetadata;
  relevamiento: RelevamientoMetadata;
  accidente: AccidenteMetadata;
  otros: OtrosMetadata;
};

/**
 * Custom hook: instancia 1 useForm por tipo (5 total). React requiere que
 * los hooks se llamen en orden fijo — usar Object.fromEntries con map sobre
 * INFORME_TIPOS VIOLA reglas de hooks. Por eso los hardcodemos en bloque.
 *
 * Las instancias sobreviven a cambios de `tipoWatch` (no se desmontan).
 * Cambiar de tipo y volver preserva los values ingresados (UX preferida).
 */
function useFormsByTipo(): {
  [K in InformeTipo]: UseFormReturn<MetadataByTipo[K]>;
} {
  const rgrl = useForm<RgrlMetadata>({
    resolver: zodResolver(rgrlMetadataSchema),
    defaultValues: rgrlMetadataDefaults(),
  });
  const capacitacion = useForm<CapacitacionMetadata>({
    resolver: zodResolver(capacitacionMetadataSchema),
    defaultValues: capacitacionMetadataDefaults(),
  });
  const relevamiento = useForm<RelevamientoMetadata>({
    resolver: zodResolver(relevamientoMetadataSchema),
    defaultValues: relevamientoMetadataDefaults(),
  });
  const accidente = useForm<AccidenteMetadata>({
    resolver: zodResolver(accidenteMetadataSchema),
    defaultValues: accidenteMetadataDefaults(),
  });
  const otros = useForm<OtrosMetadata>({
    resolver: zodResolver(otrosMetadataSchema),
    defaultValues: otrosMetadataDefaults(),
  });
  return { rgrl, capacitacion, relevamiento, accidente, otros };
}

export function InformeNuevoForm({ plantillas }: { plantillas: PlantillaClientItem[] }) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>('tipo');
  const [isPending, setIsPending] = useState(false);

  // T-050 · Cliente vinculado (opcional). Se preserva al cambiar de tipo dentro
  // del wizard (decisión 12 del plan T-050: UX simple sin re-populate auto al
  // cambiar tipo — user re-clickea el resultado para repopular el nuevo form).
  const [selectedClienteId, setSelectedClienteId] = useState<string | null>(null);
  const [selectedRazonSocial, setSelectedRazonSocial] = useState<string | null>(null);

  const baseForm = useForm<CreateInformeInput>({
    resolver: zodResolver(createInformeSchema),
    defaultValues: { tipo: 'relevamiento', titulo: '' },
  });

  const forms = useFormsByTipo();

  // eslint-disable-next-line react-hooks/incompatible-library
  const tipoWatch = baseForm.watch('tipo');
  // PARADA #3: todos los 5 tipos tienen metadata, asi que siempre hay step 2.
  const tipoHasMetadata = TEMPLATE_CLIENT_REGISTRY[tipoWatch] !== null;

  /**
   * T-050 · Al seleccionar (o limpiar) un cliente del autocomplete, populamos
   * los fields del form activo según el subset que use el tipo
   * (rgrl/relevamiento → 5 fields; capacitacion/accidente → 3; otros → 2).
   *
   * `shouldDirty: true` marca el field como modificado (RHF UI feedback).
   * `shouldValidate: true` dispara la validación inline post-set (si la
   * provincia legacy quedó '' por fallback, el error se muestra al user).
   */
  function handleClienteSelect(cliente: ClienteSummary | null) {
    if (cliente === null) {
      setSelectedClienteId(null);
      setSelectedRazonSocial(null);
      // NO reseteamos los fields del form — user puede haber editado manual
      // y queremos preservar ese trabajo.
      return;
    }
    setSelectedClienteId(cliente.id);
    setSelectedRazonSocial(cliente.razon_social);

    const tipo = baseForm.getValues('tipo');
    const values = mapClienteToFormValues(cliente, tipo);
    const activeForm = forms[tipo] as unknown as UseFormReturn<FieldValues>;

    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      activeForm.setValue(key, value, { shouldDirty: true, shouldValidate: true });
    }
  }

  async function submitWithMetadata(metadata: MetadataByTipo[InformeTipo] | undefined) {
    setIsPending(true);
    const values = baseForm.getValues();
    const result = await createInformeAction({
      ...values,
      metadata,
      cliente_id: selectedClienteId,
    });

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
      // T-050 · Si el error vino del cross-tenant defense del cliente_id, limpiar
      // la selección y mantenerlo en step 2 (no tiene sentido volver a step 1 —
      // el field cliente_id NO está en step 1). El toast con `result.message` ya
      // dice "Revisá la selección de cliente.".
      if ('cliente_id' in result.fieldErrors) {
        setSelectedClienteId(null);
        setSelectedRazonSocial(null);
        toast.error('Cliente inválido', { description: result.message });
        return;
      }
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
      case 'BILLING_GATED':
        toast.error('Plan expirado', {
          description: result.message,
          action: { label: 'Suscribirme', onClick: () => router.push('/settings/billing') },
        });
        return;
      case 'INTERNAL_ERROR':
        toast.error('Error inesperado', { description: result.message });
        return;
    }
  }

  /** Step 1 submit handler. Si tiene metadata → avanza al step 2; sino → submit. */
  async function onStep1Submit() {
    if (tipoHasMetadata) {
      setStep('metadata');
      return;
    }
    await submitWithMetadata(undefined);
  }

  /** Step 2 submit handler. Valida + envia con metadata del tipo activo. */
  async function onStep2Submit(values: MetadataByTipo[InformeTipo]) {
    await submitWithMetadata(values);
  }

  const tipoEntry = TEMPLATE_CLIENT_REGISTRY[tipoWatch];
  const FormComponent = tipoEntry.FormComponent;
  // Cast a unknown para evitar variance issues — el render correcto se
  // garantiza por contruccion (el form que pasamos es el del tipoWatch).
  const activeForm = forms[tipoWatch] as UseFormReturn<MetadataByTipo[InformeTipo]>;

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
                  {tipoHasMetadata
                    ? 'Siguiente: cargar datos'
                    : isPending
                      ? 'Creando…'
                      : 'Crear informe'}
                </Button>
              </div>
            </form>
          </Form>
        )}

        {step === 'metadata' && (
          <Form {...activeForm}>
            <form
              onSubmit={(e) => void activeForm.handleSubmit(onStep2Submit)(e)}
              className="space-y-6"
              noValidate
            >
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {STEP2_TITLE_BY_TIPO[tipoWatch]}
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Esta información se inyecta al prompt de la IA para que genere un borrador 80-90%
                  completo en lugar de placeholders.
                </p>
              </div>

              {/* T-050 · Cliente vinculado (opcional, autopopula los fields del form). */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Vincular cliente (opcional)</p>
                <p className="text-muted-foreground text-xs">
                  Seleccioná un cliente existente para autocompletar los datos de identificación.
                </p>
                <ClienteAutocomplete
                  selectedClienteId={selectedClienteId}
                  selectedRazonSocial={selectedRazonSocial}
                  onSelect={handleClienteSelect}
                  disabled={isPending}
                />
              </div>

              {/* T-139 · Aplicar/guardar plantillas de personalizacion del tipo
                  activo. Snapshot-on-apply: copia la config a este form. */}
              <PlantillaControls
                tipo={tipoWatch}
                form={activeForm as unknown as UseFormReturn<FieldValues>}
                plantillas={plantillas.filter((p) => p.tipo === tipoWatch)}
                disabled={isPending}
              />

              <FormComponent form={activeForm} disabled={isPending} />

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
                          Podés cargar los datos del informe después desde el editor.
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
