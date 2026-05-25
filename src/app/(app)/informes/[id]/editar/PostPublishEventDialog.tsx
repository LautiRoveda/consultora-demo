'use client';

import type { CalendarEventTipo } from '@/app/(app)/calendario/defaults';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { createCalendarEventAction } from '@/app/(app)/calendario/actions';
import {
  DEFAULT_REMINDER_OFFSETS_BY_TYPE,
  EVENT_TIPO_VALUES,
} from '@/app/(app)/calendario/defaults';
import { civilIsoToDate, dateToCivilIso } from '@/app/(app)/calendario/event-form-helpers';
import { EVENT_TIPO_LABELS } from '@/app/(app)/calendario/labels';
import { addRecurrenceMonths } from '@/shared/calendar/scheduling';
import { formatCivilDateLongAR } from '@/shared/lib/format-date';
import { cn } from '@/shared/lib/utils';
import {
  buildDefaultEventoTitulo,
  mapInformeTipoToEventoConfig,
} from '@/shared/templates/informe-to-event';
import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { type InformeTipo } from '../../schema';

/**
 * T-036 · Modal post-firma para agendar vencimiento.
 *
 * Se abre desde PublishButton SOLO si:
 *  - publish OK + autoCreatedEventId=null
 *  - consultora.auto_create_event_on_sign === false
 *  - tipo de informe es recurrente (rgrl / relevamiento / capacitacion)
 *  - el informe no tiene evento vinculado previo
 *
 * Form prepop con mapping (informe-to-event helper) + razón social del
 * metadata si existe. User puede editar todos los fields o cancelar.
 */

type FormValues = {
  tipo: CalendarEventTipo;
  titulo: string;
  fecha_vencimiento: string; // YYYY-MM-DD
  crearRecordatorios: boolean;
};

const dialogSchema = z.object({
  tipo: z.enum(EVENT_TIPO_VALUES, { message: 'Elegí un tipo de vencimiento.' }),
  titulo: z
    .string()
    .trim()
    .min(3, { message: 'Mínimo 3 caracteres.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato YYYY-MM-DD.' }),
  crearRecordatorios: z.boolean(),
});

export type PostPublishEventDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  informeId: string;
  informeTipo: InformeTipo;
  informeTitulo: string;
  /** Del informe_metadata, si existe. Fallback al titulo. */
  defaultRazonSocial: string | null;
};

export function PostPublishEventDialog({
  open,
  onOpenChange,
  informeId,
  informeTipo,
  informeTitulo,
  defaultRazonSocial,
}: PostPublishEventDialogProps) {
  const router = useRouter();

  // Mapping define el tipo de evento default + recurrencia.
  // Si el tipo de informe NO es recurrente, este componente no debería
  // mostrarse (gate en PublishButton). Defensa: usamos custom como fallback.
  const config = useMemo(() => mapInformeTipoToEventoConfig(informeTipo), [informeTipo]);

  const defaultValues = useMemo<FormValues>(() => {
    const eventTipo: CalendarEventTipo = config?.eventTipo ?? 'custom';
    const months = config?.recurrenceMonths ?? 12;
    const todayIso = new Date().toISOString().slice(0, 10);
    return {
      tipo: eventTipo,
      titulo: buildDefaultEventoTitulo({
        informeTitulo,
        razonSocial: defaultRazonSocial,
        eventTipo,
      }),
      fecha_vencimiento: addRecurrenceMonths(todayIso, months),
      crearRecordatorios: true,
    };
  }, [config, informeTitulo, defaultRazonSocial]);

  const form = useForm<FormValues>({
    resolver: zodResolver(dialogSchema),
    defaultValues,
    values: defaultValues, // re-prepop si props cambian (defensa contra reopen)
  });

  async function onSubmit(values: FormValues) {
    const result = await createCalendarEventAction({
      tipo: values.tipo,
      titulo: values.titulo,
      fecha_vencimiento: values.fecha_vencimiento,
      informe_id: informeId,
      recurrence_months: config?.recurrenceMonths ?? 12,
      reminder_offsets_days: values.crearRecordatorios
        ? [...DEFAULT_REMINDER_OFFSETS_BY_TYPE[values.tipo]]
        : undefined,
    });

    if (!result.ok) {
      switch (result.code) {
        case 'INVALID_INPUT':
          toast.error('Datos inválidos', { description: result.message });
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        case 'NO_CONSULTORA':
          toast.error('Cuenta sin consultora', { description: result.message });
          return;
        case 'FORBIDDEN':
          toast.error('Sin permiso', { description: result.message });
          return;
        case 'INTERNAL_ERROR':
          toast.error('Error', { description: result.message });
          return;
      }
    }

    if (result.ok) {
      toast.success('Vencimiento creado', {
        action: {
          label: 'Ver',
          onClick: () => router.push(`/calendario/agenda?event=${result.eventId}`),
        },
      });
      onOpenChange(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>¿Querés agendar la renovación?</DialogTitle>
          <DialogDescription>
            Se va a crear un vencimiento en el calendario con recordatorios automáticos. Podés
            ajustar los datos antes de guardar.
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
              name="tipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de vencimiento</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí un tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {EVENT_TIPO_VALUES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {EVENT_TIPO_LABELS[t]}
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
              name="titulo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={200} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="fecha_vencimiento"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Fecha de vencimiento</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            'w-full justify-start text-left font-normal',
                            !field.value && 'text-muted-foreground',
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {field.value ? formatCivilDateLongAR(field.value) : 'Elegí una fecha'}
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value ? civilIsoToDate(field.value) : undefined}
                        onSelect={(date) => {
                          if (date) field.onChange(dateToCivilIso(date));
                        }}
                        captionLayout="dropdown"
                        startMonth={new Date(2024, 0)}
                        endMonth={new Date(new Date().getFullYear() + 5, 11)}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="crearRecordatorios"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3 rounded-md border p-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="cursor-pointer">
                      Crear recordatorios automáticos
                    </FormLabel>
                    <p className="text-muted-foreground text-xs">
                      Te avisamos por email + Telegram (si lo tenés vinculado) antes del
                      vencimiento.
                    </p>
                  </div>
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={form.formState.isSubmitting}
              >
                Ahora no
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Agendando…' : 'Agendar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
