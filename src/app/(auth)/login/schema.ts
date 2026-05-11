import { z } from 'zod';

/**
 * Schemas de input compartidos entre el client (RHF + zodResolver) y las
 * server actions de /login.
 *
 * **Viven en su propio archivo NO `'use server'`** porque cuando un Client
 * Component importa de un módulo `'use server'`, Next.js convierte los
 * exports en proxies de RSC y `zodResolver` rompe.
 */
export const loginInputSchema = z.object({
  email: z.string().email({ message: 'Ingresá un email válido.' }),
  password: z.string().min(8, { message: 'Mínimo 8 caracteres.' }),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

/**
 * Magic link solo necesita el email. La validación min(8) de password no
 * aplica acá — el user se autentica con el link que llega al inbox.
 */
export const magicLinkInputSchema = z.object({
  email: z.string().email({ message: 'Ingresá un email válido.' }),
});

export type MagicLinkInput = z.infer<typeof magicLinkInputSchema>;
