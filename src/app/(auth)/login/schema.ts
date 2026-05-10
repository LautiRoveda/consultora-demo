import { z } from 'zod';

/**
 * Schema de input compartido entre client (RHF + zodResolver) y server action.
 *
 * **Vive en su propio archivo NO `'use server'`** porque cuando un Client
 * Component importa de un módulo `'use server'`, Next.js convierte los
 * exports en proxies de RSC. Un proxy no es un Zod schema válido para
 * `zodResolver` — el build prerender de `/login` rompe con
 * "Invalid input: not a Zod schema".
 */
export const loginInputSchema = z.object({
  email: z.string().email({ message: 'Ingresá un email válido.' }),
  password: z.string().min(8, { message: 'Mínimo 8 caracteres.' }),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
