import { z } from 'zod';

/**
 * T-025 · Body schema del POST /api/informes/[id]/generate-stream.
 *
 * Mismo shape que `generateInformeInputSchema` de T-020 (intencionalmente —
 * el route handler reemplaza el camino que hoy va por server action). Cuando
 * se remueva la action vieja en T-025-FU1, esto queda como single source of
 * truth para el contrato del input de generacion.
 *
 * Sin `'use server'` — los Route Handlers NO requieren la directiva, pero la
 * convencion del repo es separar schemas para que puedan importarse desde
 * tests sin arrastrar deps server-only.
 */
export const generateStreamBodySchema = z.object({
  userPrompt: z
    .string()
    .trim()
    .max(2000, { message: 'Máximo 2000 caracteres en el contexto opcional.' })
    .optional()
    .default(''),
});

export type GenerateStreamBody = z.infer<typeof generateStreamBodySchema>;
