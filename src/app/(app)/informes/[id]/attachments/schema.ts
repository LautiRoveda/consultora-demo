/**
 * T-024 · Zod schemas para acciones de adjuntos.
 *
 * Sin `'use server'` — se importan tanto desde server actions / route handlers
 * (validar input) como desde client (RHF resolver).
 */
import { z } from 'zod';

import { MAX_CAPTION_LENGTH } from '@/shared/storage/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const updateCaptionInputSchema = z.object({
  caption: z
    .string()
    .max(MAX_CAPTION_LENGTH, `El caption no puede exceder ${MAX_CAPTION_LENGTH} caracteres.`)
    .transform((v) => v.trim())
    .nullable(),
});
export type UpdateCaptionInput = z.infer<typeof updateCaptionInputSchema>;

export const reorderInputSchema = z.object({
  orderedIds: z
    .array(z.string().regex(UUID_REGEX, 'ID de adjunto invalido.'))
    .min(1, 'La lista de orden no puede estar vacia.')
    .max(50, 'Demasiados adjuntos en una sola operacion.'),
});
export type ReorderInput = z.infer<typeof reorderInputSchema>;
