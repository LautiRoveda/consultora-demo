import { z } from 'zod';

import { INFORME_TIPOS } from '../schema';

/**
 * T-139 · Schemas de input del modulo de plantillas de informes.
 *
 * NO `'use server'` — se importa desde Client Components (dialogs RHF).
 *
 * `PLANTILLA_NOMBRE_MAX` es espejo TS del check de `informe_plantillas.nombre`
 * (`length(trim(nombre)) between 1 and 80`, migracion 20260610000001).
 *
 * `config` entra como `z.unknown()`: el shape per-tipo lo valida la action con
 * `PLANTILLA_CONFIG_SCHEMA_BY_TIPO[tipo]` (no se puede expresar aca sin
 * duplicar el discriminado por tipo, y el error de config no es un fieldError
 * del dialog — el dialog solo edita `nombre`).
 */

export const PLANTILLA_NOMBRE_MAX = 80;

export const plantillaNombreSchema = z
  .string()
  .trim()
  .min(1, { message: 'Poné un nombre para la plantilla.' })
  .max(PLANTILLA_NOMBRE_MAX, { message: `Máximo ${PLANTILLA_NOMBRE_MAX} caracteres.` });

export const createPlantillaSchema = z.object({
  tipo: z.enum(INFORME_TIPOS, { message: 'Tipo de informe inválido.' }),
  nombre: plantillaNombreSchema,
  config: z.unknown(),
});

export type CreatePlantillaInput = z.infer<typeof createPlantillaSchema>;

export const renamePlantillaSchema = z.object({
  id: z.string().uuid({ message: 'UUID inválido.' }),
  nombre: plantillaNombreSchema,
});

export type RenamePlantillaInput = z.infer<typeof renamePlantillaSchema>;

export const plantillaIdSchema = z.string().uuid({ message: 'UUID inválido.' });
