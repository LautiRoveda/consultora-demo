import { z } from 'zod';

/**
 * T-106 · Body schema para POST /api/epp/sugerir-epp.
 *
 * Mínimo: solo `empleado_id`. Toda la lógica de scope se resuelve server-side
 * con la sesión + RLS.
 */
export const sugerirEppBodySchema = z.object({
  empleado_id: z.string().uuid({ message: 'empleado_id debe ser UUID.' }),
});

export type SugerirEppBody = z.infer<typeof sugerirEppBodySchema>;
