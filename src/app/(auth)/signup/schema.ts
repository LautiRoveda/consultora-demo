import { z } from 'zod';

/**
 * Schema de input compartido entre el client (RHF + zodResolver) y la server
 * action de signup.
 *
 * **Vive en su propio archivo NO `'use server'`** porque cuando un Client
 * Component importa de un módulo `'use server'`, Next.js convierte los
 * exports en proxies de RSC y `zodResolver` rompe. Mismo patrón que login.
 */
export const signupInputSchema = z.object({
  email: z.string().email({ message: 'Ingresá un email válido.' }),
  password: z.string().min(8, { message: 'Mínimo 8 caracteres.' }),
  consultoraName: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(80, { message: 'Máximo 80 caracteres.' }),
});

export type SignupInput = z.infer<typeof signupInputSchema>;
