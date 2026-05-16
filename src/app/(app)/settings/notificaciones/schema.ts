import { z } from 'zod';

/**
 * T-035 · Zod input schema para `updateNotificationPrefsAction`.
 *
 * NO `'use server'` — el client lo importa via zodResolver. Si fuera server,
 * Next.js convierte los exports en RSC proxies y zodResolver rompe (lecciones
 * de T-028 con `calendario/schema.ts`).
 *
 * Telegram y Push NO estan en el schema: en T-035 son disabled en UI y el
 * server action los fuerza a `enabled=false`. Cuando lleguen T-033/T-034 hay
 * que extender el schema con sus toggles.
 */

const fechaIsoField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Fecha invalida (YYYY-MM-DD).' });

export const muteInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('days'),
    days: z.union([z.literal(7), z.literal(14)]),
  }),
  z.object({
    type: z.literal('until'),
    date: fechaIsoField,
  }),
]);
export type MuteInput = z.infer<typeof muteInputSchema>;

export const updateNotificationPrefsSchema = z.object({
  emailEnabled: z.boolean(),
  mute: muteInputSchema,
});
export type UpdateNotificationPrefsInput = z.infer<typeof updateNotificationPrefsSchema>;
