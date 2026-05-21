import { z } from 'zod';

/**
 * T-071 · Inputs validados de las server actions de billing.
 *
 * Sin `'use server'` — esto lo importan los tests + el form server-side, no
 * son endpoints expuestos.
 */

export const suscripcionIdSchema = z.string().uuid({ message: 'UUID inválido.' });

export type SuscripcionId = z.infer<typeof suscripcionIdSchema>;
