'use client';

import type { MuteInput, UpdateNotificationPrefsInput } from './schema';
import type { TelegramRowState } from './TelegramChannelRow';
import { zodResolver } from '@hookform/resolvers/zod';
import { startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Bell, CalendarIcon, Mail } from 'lucide-react';
import { useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { civilIsoToDate, dateToCivilIso } from '@/app/(app)/calendario/event-form-helpers';
import { formatCivilDateLongAR, formatDateLongAR } from '@/shared/lib/format-date';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
import { Card, CardContent } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Switch } from '@/shared/ui/switch';
import { TooltipProvider } from '@/shared/ui/tooltip';

import { updateNotificationPrefsAction } from './actions';
import { getMuteStatus } from './mute-helpers';
import { PushChannelRow } from './PushChannelRow';
import { TelegramChannelRow } from './TelegramChannelRow';

export type ChannelPrefRow = {
  channel: 'email' | 'telegram' | 'push';
  enabled: boolean;
  muted_until: string | null;
};

/**
 * T-035 · UI de preferencias de notificacion.
 *
 * Form values diferentes del action input por UX:
 *  - 4 radios planos `none | 7d | 14d | until` (mas claro que sub-niveles).
 *  - `muteDate` siempre presente como string (vacio si no aplica) — la
 *    discriminated union del action se construye en `toActionInput`.
 *
 * Telegram + Push: disabled en T-035 (T-033/T-034 los habilitan). El toggle
 * Switch nativo `disabled` no dispara pointer events → tooltip Radix no
 * aparece. Wrap del row `<div>` en `<TooltipTrigger asChild>` para que el
 * hover del card entero dispare el tooltip.
 *
 * Date picker: reusa `dateToCivilIso` / `civilIsoToDate` de T-029. Disabled
 * dias pasados (no hoy — end-of-day UTC de hoy sigue siendo futuro a menos
 * que el user este en TZ tan oriental que el dia UTC ya avanzo; el action
 * normaliza ese edge case a `null` si `muted_until <= now`).
 */

const muteOptionEnum = z.enum(['none', '7d', '14d', 'until']);
type MuteOption = z.infer<typeof muteOptionEnum>;

const formSchema = z
  .object({
    emailEnabled: z.boolean(),
    muteOption: muteOptionEnum,
    muteDate: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.muteOption === 'until') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.muteDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['muteDate'],
          message: 'Elegí una fecha valida.',
        });
      }
    }
  });
type FormValues = z.infer<typeof formSchema>;

function muteStatusToFormState(
  prefs: ReadonlyArray<ChannelPrefRow>,
  now: Date,
): {
  muteOption: MuteOption;
  muteDate: string;
} {
  const status = getMuteStatus(prefs, now);
  if (status.state === 'active') return { muteOption: 'none', muteDate: '' };
  return { muteOption: 'until', muteDate: status.untilIso.slice(0, 10) };
}

function toActionInput(values: FormValues): UpdateNotificationPrefsInput {
  const mute: MuteInput =
    values.muteOption === 'none'
      ? { type: 'none' }
      : values.muteOption === '7d'
        ? { type: 'days', days: 7 }
        : values.muteOption === '14d'
          ? { type: 'days', days: 14 }
          : { type: 'until', date: values.muteDate };
  return { emailEnabled: values.emailEnabled, mute };
}

export function NotificacionesSettingsView({
  userEmail,
  initialPrefs,
  telegramInitialState,
  vapidPublicKey,
}: {
  userEmail: string;
  initialPrefs: { email: ChannelPrefRow; telegram: ChannelPrefRow; push: ChannelPrefRow };
  telegramInitialState: TelegramRowState;
  vapidPublicKey: string;
}) {
  const [pending, startTransition] = useTransition();
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const prefsArray = [initialPrefs.email, initialPrefs.telegram, initialPrefs.push];
  const initialMute = muteStatusToFormState(prefsArray, new Date());
  const initialMuteStatus = getMuteStatus(prefsArray, new Date());

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      emailEnabled: initialPrefs.email.enabled,
      muteOption: initialMute.muteOption,
      muteDate: initialMute.muteDate,
    },
  });

  // useWatch en lugar de form.watch() — React Compiler bloquea form.watch()
  // con warning "incompatible library" + el lint pre-commit corre con
  // --max-warnings=0. Lecciones de T-029.
  const muteOption = useWatch({ control: form.control, name: 'muteOption' });
  const emailEnabled = useWatch({ control: form.control, name: 'emailEnabled' });

  function onSubmit(values: FormValues): void {
    startTransition(async () => {
      const res = await updateNotificationPrefsAction(toActionInput(values));
      if (res.ok) {
        toast.success('Preferencias actualizadas.');
      } else if (res.code === 'INVALID_INPUT') {
        toast.error('Datos invalidos. Revisa la fecha de fin de pausa.');
      } else if (res.code === 'UNAUTHENTICATED') {
        toast.error('Tu sesion expiro. Inicia sesion de nuevo.');
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <TooltipProvider>
      <Form {...form}>
        <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div>
                <h2 className="text-lg font-semibold">Canales habilitados</h2>
                <p className="text-muted-foreground text-sm">
                  Elegí por dónde recibir los recordatorios de vencimientos.
                </p>
              </div>

              <FormField
                control={form.control}
                name="emailEnabled"
                render={({ field }) => (
                  <FormItem
                    className="flex items-center justify-between gap-4 rounded-md border p-3"
                    data-testid="row-email"
                  >
                    <div className="flex items-start gap-3">
                      <Mail className="text-muted-foreground mt-0.5 h-4 w-4" />
                      <div className="space-y-0.5">
                        <FormLabel className="text-sm font-medium">Email</FormLabel>
                        <p className="text-muted-foreground text-xs">
                          {field.value && userEmail
                            ? `Reminders a: ${userEmail}`
                            : 'No se enviarán mails.'}
                        </p>
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={pending}
                        aria-label="Recibir reminders por email"
                        data-testid="toggle-email"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <TelegramChannelRow initialState={telegramInitialState} />

              <PushChannelRow vapidPublicKey={vapidPublicKey} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div>
                <h2 className="text-lg font-semibold">Pausar notificaciones</h2>
                <p className="text-muted-foreground text-sm">
                  Aplica a todos los canales habilitados.
                </p>
              </div>

              {initialMuteStatus.state === 'paused' && (
                <Alert data-testid="mute-status-alert">
                  <Bell className="h-4 w-4" />
                  <AlertTitle>Pausadas</AlertTitle>
                  <AlertDescription>
                    No vas a recibir notificaciones hasta el{' '}
                    {formatDateLongAR(initialMuteStatus.untilIso)}.
                  </AlertDescription>
                </Alert>
              )}

              <FormField
                control={form.control}
                name="muteOption"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duración del pausado</FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value}
                        onValueChange={(v) => {
                          field.onChange(v);
                          if (v !== 'until') form.setValue('muteDate', '');
                          else if (!form.getValues('muteDate')) {
                            form.setValue('muteDate', dateToCivilIso(new Date()));
                          }
                        }}
                        className="gap-2"
                      >
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <RadioGroupItem value="none" id="mute-none" />
                          <span>No pausar</span>
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <RadioGroupItem value="7d" id="mute-7d" />
                          <span>7 días</span>
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <RadioGroupItem value="14d" id="mute-14d" />
                          <span>14 días</span>
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <RadioGroupItem value="until" id="mute-until" />
                          <span>Hasta fecha específica</span>
                        </label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {muteOption === 'until' && (
                <FormField
                  control={form.control}
                  name="muteDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Fecha de fin de pausa</FormLabel>
                      <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={pending}
                              className={cn(
                                'w-full justify-start text-left font-normal sm:w-auto',
                                !field.value && 'text-muted-foreground',
                              )}
                              data-testid="mute-date-trigger"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value ? formatCivilDateLongAR(field.value) : 'Elegir fecha'}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ? civilIsoToDate(field.value) : undefined}
                            onSelect={(d) => {
                              if (d) {
                                field.onChange(dateToCivilIso(d));
                                setDatePickerOpen(false);
                              }
                            }}
                            disabled={(d) => startOfDay(d) < startOfDay(new Date())}
                            locale={es}
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending} data-testid="submit-prefs">
              {pending ? 'Guardando...' : 'Guardar cambios'}
            </Button>
            {!emailEnabled && muteOption === 'none' && (
              <p className="text-muted-foreground text-xs">
                No vas a recibir notificaciones por ningún canal.
              </p>
            )}
          </div>
        </form>
      </Form>
    </TooltipProvider>
  );
}
