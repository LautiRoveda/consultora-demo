import { z } from 'zod';

import { cuitField } from './cuit';
import { FECHA_ISO_REGEX } from './sanitize';
import { PROVINCIA_CODES } from './site';

/**
 * T-022 · Factories de campos comunes a todos los templates.
 *
 * Patron: cada `<tipo>MetadataSchema` spreadea uno de los factories y agrega
 * sus campos especificos. Los nombres de keys son intencionalmente identicos
 * entre tipos para que el jsonb persistido sea legible cross-tipo.
 *
 * IMPORTANT: NO `'use server'` ni `'use client'` — este archivo es agnostic
 * y se importa desde ambos contextos. Las factories devuelven OBJETOS (no
 * ZodObject) para que el caller pueda spreadear y extender el shape sin
 * encadenar `.extend()` (mas legible + RHF feliz).
 */

/**
 * 3 campos basicos de identificacion de cliente. Sirve cuando el informe NO
 * es sitio-especifico (capacitacion, accidente, otros — la dimension fisica
 * vive en otros campos especificos).
 */
export const commonClientFields = () => ({
  razon_social: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(120, { message: 'Máximo 120 caracteres.' }),
  cuit: cuitField,
  domicilio: z
    .string()
    .trim()
    .min(3, { message: 'Mínimo 3 caracteres.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),
});

/**
 * Identificacion + sitio (localidad + provincia). Aplica cuando el informe ES
 * sitio-especifico (RGRL, relevamiento general).
 */
export const commonClientFieldsWithSite = () => ({
  ...commonClientFields(),
  localidad: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(80, { message: 'Máximo 80 caracteres.' }),
  provincia: z.enum(PROVINCIA_CODES, { message: 'Elegí una provincia.' }),
});

/**
 * Field reusable: fecha en formato ISO YYYY-MM-DD (formato nativo de
 * `<Input type="date">`). Cada schema lo nombra `fecha_<tipo>` para
 * mantener semantica explicita (decision Q11.d).
 */
export const fechaIsoField = z
  .string()
  .regex(FECHA_ISO_REGEX, { message: 'Formato YYYY-MM-DD.' })
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Fecha inválida.' });
