import { z } from 'zod';

/**
 * Schema de input para `updatePasswordAction`.
 *
 * - `password` mínimo 8 chars (alineado con signup T-012 y login T-013).
 * - `confirmPassword` se valida igual via `refine` para no aceptar typos.
 *
 * **Vive en su propio archivo NO `'use server'`** porque cuando un Client
 * Component importa de un módulo `'use server'`, Next.js convierte los
 * exports en proxies de RSC y `zodResolver` rompe.
 */
export const updatePasswordInputSchema = z
  .object({
    password: z.string().min(8, { message: 'Mínimo 8 caracteres.' }),
    confirmPassword: z.string().min(8, { message: 'Confirmá la contraseña.' }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmPassword'],
  });

export type UpdatePasswordInput = z.infer<typeof updatePasswordInputSchema>;
