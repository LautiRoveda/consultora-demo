import { z } from 'zod';

import { fechaIsoField } from '@/shared/templates/common/schema';

import {
  CANCEL_REASON_MAX_LENGTH,
  DESCRIPCION_MAX_LENGTH,
  EVENT_TIPO_VALUES,
  OFFSET_DAYS_MAX,
  OFFSET_DAYS_MIN,
  RECURRENCE_MONTHS_MAX,
  RECURRENCE_MONTHS_MIN,
  REMINDER_OFFSETS_MAX_COUNT,
  TITULO_MAX_LENGTH,
  TITULO_MIN_LENGTH,
} from './defaults';

/**
 * T-028 · Zod input schemas para las server actions del modulo Calendario.
 *
 * NO `'use server'` — se importa desde Client (RHF + zodResolver en T-029) y
 * desde las actions. Si fuera server, Next.js convierte los exports en RSC
 * proxies y zodResolver rompe.
 *
 * Reusa `fechaIsoField` (YYYY-MM-DD) de templates/common — mismo formato del
 * `<Input type="date">` nativo.
 */

const reminderOffsetsField = z
  .array(
    z
      .number()
      .int({ message: 'Días enteros.' })
      .min(OFFSET_DAYS_MIN, { message: 'Mínimo 0 días.' })
      .max(OFFSET_DAYS_MAX, { message: 'Máximo 365 días.' }),
  )
  .min(1, { message: 'Mínimo 1 recordatorio.' })
  .max(REMINDER_OFFSETS_MAX_COUNT, {
    message: `Máximo ${REMINDER_OFFSETS_MAX_COUNT} recordatorios.`,
  })
  .refine((arr) => new Set(arr).size === arr.length, { message: 'Sin offsets duplicados.' });

const recurrenceMonthsField = z
  .number()
  .int({ message: 'Meses enteros.' })
  .min(RECURRENCE_MONTHS_MIN, { message: 'Mínimo 1 mes.' })
  .max(RECURRENCE_MONTHS_MAX, { message: 'Máximo 60 meses (5 años).' });

const tituloField = z
  .string()
  .trim()
  .min(TITULO_MIN_LENGTH, { message: `Mínimo ${TITULO_MIN_LENGTH} caracteres.` })
  .max(TITULO_MAX_LENGTH, { message: `Máximo ${TITULO_MAX_LENGTH} caracteres.` });

const descripcionField = z
  .string()
  .max(DESCRIPCION_MAX_LENGTH, { message: `Máximo ${DESCRIPCION_MAX_LENGTH} caracteres.` })
  .nullable();

/**
 * jsonb metadata. `unknown` para que el caller pueda persistir shape arbitrario;
 * el CHECK SQL `pg_column_size <= 4 KB` actua como hard cap server-side.
 */
const metadataField = z.record(z.string(), z.unknown()).nullable();

export const createCalendarEventSchema = z.object({
  tipo: z.enum(EVENT_TIPO_VALUES, { message: 'Elegí un tipo de vencimiento.' }),
  titulo: tituloField,
  fecha_vencimiento: fechaIsoField,
  descripcion: descripcionField.optional(),
  informe_id: z.string().uuid({ message: 'UUID inválido.' }).nullable().optional(),
  recurrence_months: recurrenceMonthsField.nullable().optional(),
  metadata: metadataField.optional(),
  /**
   * Si no se provee, el action resuelve via DEFAULT_REMINDER_OFFSETS_BY_TYPE.
   */
  reminder_offsets_days: reminderOffsetsField.optional(),
});
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;

/**
 * Patch parcial: cualquier subset de campos editables. `refine` exige al menos
 * un campo presente (defensa contra UPDATE no-op desde el client).
 */
export const updateCalendarEventPatchSchema = z
  .object({
    titulo: tituloField.optional(),
    descripcion: descripcionField.optional(),
    fecha_vencimiento: fechaIsoField.optional(),
    recurrence_months: recurrenceMonthsField.nullable().optional(),
    metadata: metadataField.optional(),
    reminder_offsets_days: reminderOffsetsField.optional(),
  })
  .refine((p) => Object.keys(p).length > 0, {
    message: 'Debe haber al menos un campo a actualizar.',
  });
export type UpdateCalendarEventPatch = z.infer<typeof updateCalendarEventPatchSchema>;

export const eventIdSchema = z.string().uuid({ message: 'UUID inválido.' });

export const cancelReasonSchema = z
  .string()
  .trim()
  .max(CANCEL_REASON_MAX_LENGTH, { message: `Máximo ${CANCEL_REASON_MAX_LENGTH} caracteres.` })
  .optional();
