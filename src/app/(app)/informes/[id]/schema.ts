import { z } from 'zod';

import { accidenteMetadataSchema } from '@/shared/templates/accidente/schema';
import { capacitacionMetadataSchema } from '@/shared/templates/capacitacion/schema';
import { otrosMetadataSchema } from '@/shared/templates/otros/schema';
import { relevamientoMetadataSchema } from '@/shared/templates/relevamiento/schema';
import { rgrlMetadataSchema } from '@/shared/templates/rgrl/schema';

/**
 * T-020 · Schemas de input para las actions del editor de informes.
 * T-021 · Suma `updateInformeMetadataInputSchema` para el form estructurado
 * por tipo de informe (RGRL piloto).
 * T-022 · Convierte `updateInformeMetadataInputSchema` en discriminated union
 * por `tipo` ahora que los 5 tipos tienen template.
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
const contentField = z
  .string()
  .max(200_000, { message: 'Máximo 200.000 caracteres en el contenido.' });

export const updateInformeInputSchema = z.object({
  content: contentField,
});

export type UpdateInformeContentInput = z.infer<typeof updateInformeInputSchema>;

/**
 * T-141 Fase C · Input del action de contenido. Suma `mode`:
 *  - 'commit' (default): guardado manual / submit → escribe `contenido` (auditado)
 *    y limpia el borrador. Comportamiento histórico — el form RHF (solo `content`)
 *    cae acá por el default.
 *  - 'draft': autosave → escribe SOLO `contenido_borrador` (no auditado), sin
 *    revalidatePath. El action exige `status === 'draft'` para este modo.
 */
export const updateInformeContentActionSchema = z.object({
  content: contentField,
  mode: z.enum(['draft', 'commit']).default('commit'),
});

/**
 * T-021 · Input de `updateInformeMetadataAction`.
 * T-022 · Discriminated union por `tipo`. Cada variante valida `data` contra
 * el schema del template correspondiente. El action server-side verifica que
 * `input.tipo` coincida con `informe.tipo` (defensa contra un wizard mal
 * sincronizado), y luego narrowea typesafe via `parsed.data.tipo`.
 *
 * El cliente arma `{ tipo, data: values }` antes de llamar al action. RHF
 * trabaja sobre `data` puro (uno de los 5 schemas Metadata), el wrapper se
 * adjunta justo antes del invoke.
 */
export const updateInformeMetadataInputSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('rgrl'), data: rgrlMetadataSchema }),
  z.object({ tipo: z.literal('capacitacion'), data: capacitacionMetadataSchema }),
  z.object({ tipo: z.literal('relevamiento'), data: relevamientoMetadataSchema }),
  z.object({ tipo: z.literal('accidente'), data: accidenteMetadataSchema }),
  z.object({ tipo: z.literal('otros'), data: otrosMetadataSchema }),
]);

export type UpdateInformeMetadataInput = z.infer<typeof updateInformeMetadataInputSchema>;
