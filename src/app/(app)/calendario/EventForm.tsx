'use client';

import type { Resolver } from 'react-hook-form';
import type { CalendarEventTipo } from './defaults';
import type { CalendarEventRow } from './queries';
import { zodResolver } from '@hookform/resolvers/zod';
import { es } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { formatCivilDateLongAR } from '@/shared/lib/format-date';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
import { Checkbox } from '@/shared/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';

import {
  cancelCalendarEventAction,
  createCalendarEventAction,
  updateCalendarEventAction,
} from './actions';
import {
  DEFAULT_REMINDER_OFFSETS_BY_TYPE,
  RECURRENCE_MONTHS_MAX,
  RECURRENCE_MONTHS_MIN,
  SYSTEM_GENERATED_EVENT_TIPOS,
  USER_CREATABLE_EVENT_TIPOS,
} from './defaults';
import { civilIsoToDate, dateToCivilIso, findOffsetsInPast } from './event-form-helpers';
import { EVENT_TIPO_LABELS } from './labels';
import { ReminderOffsetsInput } from './ReminderOffsetsInput';
import { createCalendarEventSchema, updateCalendarEventPatchSchema } from './schema';

/**
 * T-029 · Form RHF para crear/editar eventos del calendario.
 *
 * Reusable entre modos `create` y `edit`. El submit handler difiere segun
 * mode, pero el shape del form es el mismo (modulo `eventId` que solo aplica
 * a edit).
 *
 * Manejo del watcher tipo↔reminders (decision 4 del plan):
 *  - Al cambiar `tipo` con `remindersDirty=false` → ReminderOffsetsInput
 *    auto-prepop con `DEFAULT_REMINDER_OFFSETS_BY_TYPE[nuevoTipo]`.
 *  - Al editar manualmente los chips → flag `remindersDirty=true` → cambios
 *    posteriores de `tipo` no pisan los chips del user.
 *
 * Warning offsets en pasado (ajuste 3): useEffect recalcula la lista cuando
 * cambian fecha o offsets; muestra Alert variant warning si hay alguno.
 */

type FormValues = {
  tipo: CalendarEventTipo;
  titulo: string;
  fecha_vencimiento: string; // YYYY-MM-DD
  descripcion: string;
  recurrenceEnabled: boolean;
  recurrence_months: number;
  reminder_offsets_days: number[];
};

function defaultsForCreate(prepopFecha: string | null): FormValues {
  return {
    tipo: 'custom',
    titulo: '',
    fecha_vencimiento: prepopFecha ?? '',
    descripcion: '',
    recurrenceEnabled: false,
    recurrence_months: 12,
    reminder_offsets_days: [...DEFAULT_REMINDER_OFFSETS_BY_TYPE.custom],
  };
}

function defaultsFromEvent(event: CalendarEventRow): FormValues {
  return {
    tipo: event.tipo as CalendarEventTipo,
    titulo: event.titulo,
    fecha_vencimiento: event.fecha_vencimiento,
    descripcion: event.descripcion ?? '',
    recurrenceEnabled: event.recurrence_months !== null,
    recurrence_months: event.recurrence_months ?? 12,
    reminder_offsets_days: event.reminder_offsets_days,
  };
}

type Props =
  | {
      mode: 'create';
      prepopFecha: string | null;
      currentMonth: { year: number; month: number };
      onMutated: (opts: {
        closeDrawer?: boolean;
        gotoEventId?: string | null;
        gotoMonth?: { year: number; month: number } | null;
      }) => void;
      onCancel: () => void;
    }
  | {
      mode: 'edit';
      event: CalendarEventRow;
      currentMonth: { year: number; month: number };
      onMutated: (opts: {
        closeDrawer?: boolean;
        gotoEventId?: string | null;
        gotoMonth?: { year: number; month: number } | null;
        switchToView?: string;
      }) => void;
      onCancel: () => void;
    };

export function EventForm(props: Props) {
  const router = useRouter();
  const isEdit = props.mode === 'edit';

  // Para create usamos el schema completo; para edit el patch (todos opcionales).
  // Pero el shape del form (FormValues) es plano y consistente — solo el submit
  // serializa diferente segun mode.
  const resolver = useMemo<Resolver<FormValues>>(
    () =>
      // El resolver real lo aplicamos al submit (validacion server-side via
      // safeParse). Aca usamos un resolver "passthrough" que solo valida
      // bounds visuales — el server hace el strict.
      zodResolver(
        isEdit ? (updateCalendarEventPatchSchema as never) : (createCalendarEventSchema as never),
      ) as unknown as Resolver<FormValues>,
    [isEdit],
  );

  const form = useForm<FormValues>({
    // resolver: NO lo aplicamos aca para evitar que un patch parcial valide
    // contra el create schema (que requiere campos). Validacion full ocurre
    // server-side. Mantenemos el RHF state limpio sin resolver.
    defaultValues:
      props.mode === 'create'
        ? defaultsForCreate(props.prepopFecha)
        : defaultsFromEvent(props.event),
  });
  // Suprimir lint: queremos el resolver disponible sin aplicarlo.
  void resolver;

  const [submitting, setSubmitting] = useState(false);
  const [remindersDirty, setRemindersDirty] = useState(false);

  // T-133 · Los tipos system-generated no se ofrecen en el alta manual. Al
  // editar un evento system el Select muestra SOLO su tipo actual, disabled:
  // el tipo nunca viaja en el patch (cosmético), pero sin el item el trigger
  // del Select quedaría vacío.
  const editTipo = props.mode === 'edit' ? (props.event.tipo as CalendarEventTipo) : null;
  const isSystemTipo =
    editTipo !== null && (SYSTEM_GENERATED_EVENT_TIPOS as readonly string[]).includes(editTipo);
  const tipoOptions: readonly CalendarEventTipo[] =
    isSystemTipo && editTipo !== null ? [editTipo] : USER_CREATABLE_EVENT_TIPOS;

  // useWatch en lugar de form.watch: evita warning del React Compiler sobre
  // memoizacion (form.watch retorna funciones no-memoizables).
  const watchedTipo = useWatch({ control: form.control, name: 'tipo' });
  const watchedFecha = useWatch({ control: form.control, name: 'fecha_vencimiento' });
  const watchedOffsets = useWatch({ control: form.control, name: 'reminder_offsets_days' });
  const watchedRecurrenceEnabled = useWatch({
    control: form.control,
    name: 'recurrenceEnabled',
  });

  // Defaults memoized para el prepop reactivo del child controlado.
  const defaultsForCurrentTipo = useMemo(
    () => DEFAULT_REMINDER_OFFSETS_BY_TYPE[watchedTipo],
    [watchedTipo],
  );

  // Warning ajuste 3: offsets en pasado. Se recomputa con fecha + offsets.
  const offsetsInPast = useMemo(() => {
    if (!watchedFecha || watchedOffsets.length === 0) return [];
    return findOffsetsInPast(watchedFecha, watchedOffsets, new Date());
  }, [watchedFecha, watchedOffsets]);

  // Cancelacion (solo edit + status pending — el panel decide cuando mostrar).
  const [cancelling, setCancelling] = useState(false);

  async function onCancelEvent() {
    if (props.mode !== 'edit') return;
    setCancelling(true);
    const result = await cancelCalendarEventAction(props.event.id);
    setCancelling(false);
    if (!result.ok) {
      handleErrorCode(result.code, result.message);
      return;
    }
    toast.success('Vencimiento cancelado');
    props.onMutated({ switchToView: props.event.id });
    router.refresh();
  }

  function handleErrorCode(code: string, message: string) {
    switch (code) {
      case 'INVALID_INPUT':
        toast.error('Datos inválidos', { description: message });
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: message });
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: message });
        return;
      case 'FORBIDDEN':
        toast.error('Sin permiso', { description: message });
        return;
      case 'NOT_FOUND':
        toast.error('Vencimiento no encontrado', { description: message });
        return;
      case 'ALREADY_FINAL':
        toast.error('Estado final', { description: message });
        return;
      case 'BILLING_GATED':
        toast.error('Plan expirado', {
          description: message,
          action: { label: 'Suscribirme', onClick: () => router.push('/settings/billing') },
        });
        return;
      default:
        toast.error('Error inesperado', { description: message });
    }
  }

  async function onSubmit(values: FormValues) {
    setSubmitting(true);

    try {
      if (props.mode === 'create') {
        const result = await createCalendarEventAction({
          tipo: values.tipo,
          titulo: values.titulo,
          fecha_vencimiento: values.fecha_vencimiento,
          descripcion: values.descripcion.trim().length > 0 ? values.descripcion : null,
          recurrence_months: values.recurrenceEnabled ? values.recurrence_months : null,
          reminder_offsets_days: values.reminder_offsets_days,
        });
        if (!result.ok) {
          if (result.code === 'INVALID_INPUT') {
            for (const [field, messages] of Object.entries(result.fieldErrors)) {
              if (field in values)
                form.setError(field as keyof FormValues, { message: messages[0] });
            }
            toast.error('Datos inválidos', { description: result.message });
            return;
          }
          handleErrorCode(result.code, result.message);
          return;
        }
        toast.success('Vencimiento creado', {
          description:
            result.remindersSkippedPast > 0
              ? `${result.remindersCreated} recordatorios programados, ${result.remindersSkippedPast} omitidos por estar en el pasado.`
              : `${result.remindersCreated} recordatorios programados.`,
        });
        // Si la fecha cae fuera del mes mostrado, navegar al mes correcto.
        const eventYM = ymFromIso(values.fecha_vencimiento);
        const gotoMonth =
          eventYM.year !== props.currentMonth.year || eventYM.month !== props.currentMonth.month
            ? eventYM
            : null;
        props.onMutated({ closeDrawer: true, gotoMonth, gotoEventId: result.eventId });
      } else {
        // mode === 'edit'
        const result = await updateCalendarEventAction(props.event.id, {
          titulo: values.titulo,
          fecha_vencimiento: values.fecha_vencimiento,
          descripcion: values.descripcion.trim().length > 0 ? values.descripcion : null,
          recurrence_months: values.recurrenceEnabled ? values.recurrence_months : null,
          reminder_offsets_days: values.reminder_offsets_days,
        });
        if (!result.ok) {
          if (result.code === 'INVALID_INPUT') {
            for (const [field, messages] of Object.entries(result.fieldErrors)) {
              if (field in values)
                form.setError(field as keyof FormValues, { message: messages[0] });
            }
            toast.error('Datos inválidos', { description: result.message });
            return;
          }
          handleErrorCode(result.code, result.message);
          return;
        }
        toast.success('Vencimiento actualizado', {
          description: result.remindersRecomputed ? `Recordatorios recomputados.` : undefined,
        });
        const eventYM = ymFromIso(values.fecha_vencimiento);
        const gotoMonth =
          eventYM.year !== props.currentMonth.year || eventYM.month !== props.currentMonth.month
            ? eventYM
            : null;
        props.onMutated({ switchToView: props.event.id, gotoMonth });
      }
    } finally {
      setSubmitting(false);
      router.refresh();
    }
  }

  // Open state del Popover del date picker — controlamos para cerrar al seleccionar.
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const fechaSeleccionada = watchedFecha ? civilIsoToDate(watchedFecha) : undefined;

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="tipo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo *</FormLabel>
              <FormControl>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={submitting || isSystemTipo}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí un tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {tipoOptions.map((t) => (
                      <SelectItem key={t} value={t}>
                        {EVENT_TIPO_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="titulo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Título *</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Ej: Protocolo ruido — Metalúrgica Norte"
                  disabled={submitting}
                  maxLength={200}
                />
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
              <FormLabel>Fecha de vencimiento *</FormLabel>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={submitting}
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !field.value && 'text-muted-foreground',
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {field.value ? formatCivilDateLongAR(field.value) : 'Elegir fecha'}
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fechaSeleccionada}
                    onSelect={(d) => {
                      if (d) {
                        // Ajuste 5: usar dateToCivilIso (date-fns format), NO toISOString.
                        field.onChange(dateToCivilIso(d));
                        setDatePickerOpen(false);
                      }
                    }}
                    locale={es}
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-2">
          <FormField
            control={form.control}
            name="recurrenceEnabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center gap-2 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={submitting}
                    id="recurrence-checkbox"
                  />
                </FormControl>
                <FormLabel htmlFor="recurrence-checkbox" className="cursor-pointer">
                  Recurrente
                </FormLabel>
              </FormItem>
            )}
          />
          {watchedRecurrenceEnabled && (
            <FormField
              control={form.control}
              name="recurrence_months"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cada cuántos meses</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={RECURRENCE_MONTHS_MIN}
                      max={RECURRENCE_MONTHS_MAX}
                      value={field.value}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      disabled={submitting}
                      className="w-32"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <FormField
          control={form.control}
          name="reminder_offsets_days"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Recordatorios</FormLabel>
              <FormControl>
                <ReminderOffsetsInput
                  value={field.value}
                  onChange={field.onChange}
                  defaultsForCurrentTipo={defaultsForCurrentTipo}
                  dirty={remindersDirty}
                  onDirtyChange={setRemindersDirty}
                  disabled={submitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {offsetsInPast.length > 0 && (
          <Alert data-testid="offsets-past-warning">
            <AlertTitle>Recordatorios omitidos</AlertTitle>
            <AlertDescription>
              Los recordatorios de {offsetsInPast.join(', ')} día(s) no se van a enviar porque la
              hora programada (09:00 ART) ya pasó.
            </AlertDescription>
          </Alert>
        )}

        <FormField
          control={form.control}
          name="descripcion"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={3}
                  placeholder="Detalle, normativa, contacto del cliente..."
                  disabled={submitting}
                  maxLength={2000}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
          {props.mode === 'edit' && props.event.status === 'pending' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void onCancelEvent()}
              disabled={submitting || cancelling}
              className="text-destructive hover:bg-destructive/10"
            >
              Cancelar vencimiento
            </Button>
          )}
          <div className="flex gap-2 sm:ml-auto">
            <Button type="button" variant="outline" onClick={props.onCancel} disabled={submitting}>
              Volver
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? 'Guardando…'
                : props.mode === 'create'
                  ? 'Crear vencimiento'
                  : 'Guardar cambios'}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}

function ymFromIso(iso: string): { year: number; month: number } {
  const [y, m] = iso.split('-').map(Number) as [number, number, number];
  return { year: y, month: m };
}
