'use client';

import type { SignaturePadHandle } from '@/shared/ui/signature-pad';
import type { CerrarEjecucionInput } from './schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { MapPin } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { formatCivilDateAR } from '@/shared/lib/format-date';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { SignaturePad } from '@/shared/ui/signature-pad';

import { cerrarEjecucionAction } from './actions';
import { cerrarEjecucionSchema } from './schema';

type CapaPreview = { descripcion: string; prioridad: string; fecha_compromiso: string };

export type CerrarInspeccionFormProps = {
  executionId: string;
  /** YYYY-MM-DD. Default del input de fecha de inspección. */
  fechaInspeccionDefault: string;
  cumplimientoPct: number | null;
  tieneCriticos: boolean;
  /** Preview de las CAPAs que se van a generar (1 por "no cumple"). */
  capas: CapaPreview[];
};

const FIRMANTE_FIELDS = [
  'firma_base64',
  'firmante_nombre',
  'firmante_matricula',
  'fecha_inspeccion',
  'gps_lat',
  'gps_lng',
] as const;

/**
 * T-061b · Form de cierre con firma (owner). Molde EntregaWizard: la firma se
 * captura en canvas y se setea imperativa al submit (`firma_base64` NO es un
 * input — se valida con el `.startsWith('data:image/png;base64,')` del schema).
 * GPS opcional vía geolocation. Mobile-first: el matriculado firma en obra.
 */
export function CerrarInspeccionForm({
  executionId,
  fechaInspeccionDefault,
  cumplimientoPct,
  tieneCriticos,
  capas,
}: CerrarInspeccionFormProps) {
  const router = useRouter();
  const padRef = useRef<SignaturePadHandle>(null);
  const [firmaIsEmpty, setFirmaIsEmpty] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [gpsLabel, setGpsLabel] = useState<string | null>(null);
  const [gpsPending, setGpsPending] = useState(false);
  const [faltantes, setFaltantes] = useState<Array<{ id: string; texto: string }>>([]);

  const form = useForm<CerrarEjecucionInput>({
    resolver: zodResolver(cerrarEjecucionSchema),
    defaultValues: {
      executionId,
      firma_base64: '',
      firmante_nombre: '',
      firmante_matricula: '',
      fecha_inspeccion: fechaInspeccionDefault,
    },
  });

  function handleClearFirma() {
    padRef.current?.clear();
    setFirmaIsEmpty(true);
    form.setValue('firma_base64', '');
  }

  function handleUseLocation() {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      toast.error('Sin GPS', { description: 'Este dispositivo no expone ubicación.' });
      return;
    }
    setGpsPending(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        form.setValue('gps_lat', latitude);
        form.setValue('gps_lng', longitude);
        setGpsLabel(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        setGpsPending(false);
        toast.success('Ubicación adjuntada');
      },
      () => {
        setGpsPending(false);
        toast.error('No se pudo obtener la ubicación', {
          description: 'Permiso denegado o sin señal. Podés cerrar igual sin ubicación.',
        });
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function handleClearLocation() {
    form.setValue('gps_lat', undefined);
    form.setValue('gps_lng', undefined);
    setGpsLabel(null);
  }

  async function handleSubmit() {
    if (firmaIsEmpty) {
      toast.error('Falta firmar', { description: 'Necesitamos la firma del matriculado.' });
      return;
    }
    form.setValue('firma_base64', padRef.current?.toDataURL() ?? '');
    // Matrícula vacía → undefined (no persistir un string vacío).
    const mat = (form.getValues('firmante_matricula') ?? '').trim();
    form.setValue('firmante_matricula', mat.length > 0 ? mat : undefined);

    const ok = await form.trigger();
    if (!ok) {
      toast.error('Revisá los datos', { description: 'Hay campos marcados en rojo.' });
      return;
    }

    setIsPending(true);
    const result = await cerrarEjecucionAction(form.getValues());

    if (result.ok) {
      toast.success('Inspección cerrada y firmada', {
        description:
          result.capaCount > 0
            ? `Se generaron ${result.capaCount} acción(es) correctiva(s) en el calendario.`
            : 'Sin hallazgos pendientes.',
      });
      if (result.calendarWarning) {
        toast.info('Recordatorios pendientes', { description: result.calendarWarning });
      }
      router.push(`/checklists/ejecuciones/${executionId}`);
      router.refresh();
      return;
    }

    setIsPending(false);

    if (result.code === 'INVALID_INPUT') {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if ((FIRMANTE_FIELDS as readonly string[]).includes(field)) {
          form.setError(field as Parameters<typeof form.setError>[0], { message: messages[0] });
        }
      }
      toast.error('Revisá los datos', { description: result.message });
      return;
    }

    switch (result.code) {
      case 'EXEC_INCOMPLETE':
        setFaltantes(result.faltantes);
        toast.error('Faltan ítems obligatorios', { description: result.message });
        return;
      case 'NO_CLIENTE':
        toast.error('Falta el cliente', { description: result.message });
        return;
      case 'ALREADY_CLOSED':
      case 'EXEC_NOT_DRAFT':
        toast.info('La inspección ya fue cerrada o anulada');
        router.push(`/checklists/ejecuciones/${executionId}`);
        router.refresh();
        return;
      case 'BILLING_GATED':
        toast.error('Plan expirado', {
          description: result.message,
          action: { label: 'Suscribirme', onClick: () => router.push('/settings/billing') },
        });
        return;
      case 'FORBIDDEN_NOT_OWNER':
        toast.error('Acción reservada al titular', { description: result.message });
        return;
      case 'NOT_FOUND':
        toast.error('Inspección no encontrada');
        router.push('/checklists/ejecuciones');
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
      case 'STORAGE_ERROR':
      case 'INTERNAL_ERROR':
        toast.error('No se pudo cerrar', { description: result.message });
        return;
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumen del relevamiento</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p>
            Cumplimiento:{' '}
            <span className="font-medium">
              {cumplimientoPct != null ? `${cumplimientoPct}%` : 'No evaluable'}
            </span>
            {tieneCriticos && (
              <span className="text-destructive"> · tiene ítems críticos incumplidos</span>
            )}
          </p>

          {capas.length === 0 ? (
            <p className="text-muted-foreground">
              Sin hallazgos «no cumple»: no se generarán acciones correctivas.
            </p>
          ) : (
            <div className="grid gap-2">
              <p className="text-muted-foreground">
                Se generarán {capas.length} acción(es) correctiva(s) (entran al calendario):
              </p>
              <ul className="grid gap-2">
                {capas.map((c, i) => (
                  <li
                    key={i}
                    className="bg-muted/20 grid gap-1 rounded-md border p-3"
                    data-testid="capa-preview"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="break-words">{c.descripcion}</span>
                      {c.prioridad === 'alta' && (
                        <span className="text-destructive shrink-0 text-xs font-medium uppercase">
                          Crítica
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      Vence el {formatCivilDateAR(c.fecha_compromiso)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {faltantes.length > 0 && (
        <Card>
          <CardContent className="grid gap-2 py-4 text-sm">
            <p className="text-destructive font-medium">
              Aparecieron ítems obligatorios sin responder:
            </p>
            <ul className="list-inside list-disc">
              {faltantes.map((f) => (
                <li key={f.id}>{f.texto}</li>
              ))}
            </ul>
            <Button asChild variant="outline" size="sm">
              <Link href={`/checklists/ejecuciones/${executionId}`}>Volver a relevar</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Firma del matriculado</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              className="grid gap-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void handleSubmit();
              }}
            >
              <FormField
                control={form.control}
                name="firmante_nombre"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre del matriculado</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ing. Nombre Apellido" autoComplete="name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="firmante_matricula"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Matrícula <span className="text-muted-foreground">(opcional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        placeholder="Ej: 12345 / CPIQ 678"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fecha_inspeccion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de inspección</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-2">
                <FormLabel>Firma</FormLabel>
                <SignaturePad
                  ref={padRef}
                  onChange={(empty) => setFirmaIsEmpty(empty)}
                  ariaLabel="Pad de firma del matriculado para cerrar la inspección"
                />
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground text-xs">
                    Firmá con el dedo (mobile) o el mouse.
                  </p>
                  <Button type="button" variant="ghost" size="sm" onClick={handleClearFirma}>
                    Limpiar
                  </Button>
                </div>
                {form.formState.errors.firma_base64 && (
                  <p className="text-destructive text-xs">
                    {form.formState.errors.firma_base64.message}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleUseLocation}
                  disabled={gpsPending}
                >
                  <MapPin className="mr-2 h-4 w-4" aria-hidden="true" />
                  {gpsPending ? 'Ubicando…' : 'Usar mi ubicación (opcional)'}
                </Button>
                {gpsLabel && (
                  <span className="text-muted-foreground text-xs">
                    📍 {gpsLabel}
                    <button
                      type="button"
                      className="text-foreground ml-2 underline"
                      onClick={handleClearLocation}
                    >
                      quitar
                    </button>
                  </span>
                )}
              </div>

              <Button type="submit" disabled={isPending || firmaIsEmpty}>
                {isPending ? 'Cerrando…' : 'Cerrar y firmar inspección'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
