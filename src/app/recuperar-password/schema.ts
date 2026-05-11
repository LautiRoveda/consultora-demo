import { z } from 'zod';

/**
 * Schema de input compartido entre el client (RHF + zodResolver) y la server
 * action `recoverPasswordAction`.
 *
 * **Vive en su propio archivo NO `'use server'`** porque cuando un Client
 * Component importa de un módulo `'use server'`, Next.js convierte los
 * exports en proxies de RSC y `zodResolver` rompe. Mismo patrón que login/signup.
 */
export const recoverPasswordInputSchema = z.object({
  email: z.string().email({ message: 'Ingresá un email válido.' }),
});

export type RecoverPasswordInput = z.infer<typeof recoverPasswordInputSchema>;
