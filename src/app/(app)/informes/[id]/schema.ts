import { z } from 'zod';

/**
 * T-020 · Schemas de input para las actions del editor de informes.
 *
 * NO `'use server'` — se importan desde Client Components (RHF + zodResolver).
 */

/**
 * Input de `generateInformeContentAction`.
 *
 * `userPrompt` opcional: el user puede generar sin contexto (el system
 * prompt cubre la estructura base). Max 2000 chars para mantener el costo
 * acotado y evitar abuso del input field.
 */
export const generateInformeInputSchema = z.object({
  userPrompt: z
    .string()
    .trim()
    .max(2000, { message: 'Máximo 2000 caracteres en el contexto opcional.' })
    .optional()
    .default(''),
});

export type GenerateInformeInput = z.infer<typeof generateInformeInputSchema>;

/**
 * Input de `updateInformeContentAction`.
 *
 * `content` puede ser string vacío (el user pide guardar un informe sin
 * contenido — caso edge pero válido). Max 200_000 chars (≈50K tokens).
 * Razon del max: ningun informe HyS razonable supera ese tamaño, y poner
 * limite duro evita que un usuario malicioso/equivocado infle la tabla.
 */
export const updateInformeInputSchema = z.object({
  content: z.string().max(200_000, { message: 'Máximo 200.000 caracteres en el contenido.' }),
});

export type UpdateInformeContentInput = z.infer<typeof updateInformeInputSchema>;
