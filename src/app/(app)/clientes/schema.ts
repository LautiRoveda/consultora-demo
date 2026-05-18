import { z } from 'zod';

import { cuitField } from '@/shared/templates/common/cuit';

// Bounds — matchean los CHECK SQL de T-047 (20260517235110_clientes.sql) sin drift (1:1).
const RAZON_SOCIAL_MIN = 2;
const RAZON_SOCIAL_MAX = 200;
const NOMBRE_FANTASIA_MIN = 1;
const NOMBRE_FANTASIA_MAX = 120;
const DOMICILIO_MIN = 3;
const DOMICILIO_MAX = 200;
const LOCALIDAD_MIN = 2;
const LOCALIDAD_MAX = 80;
const PROVINCIA_MAX = 100;
const CONTACTO_NOMBRE_MIN = 2;
const CONTACTO_NOMBRE_MAX = 120;
const CONTACTO_TELEFONO_MIN = 6;
const CONTACTO_TELEFONO_MAX = 30;
const INDUSTRIA_MAX = 80;
const ART_MAX = 100;
const NOTAS_MAX = 2000;

const razonSocialField = z
  .string()
  .trim()
  .min(RAZON_SOCIAL_MIN, { message: `Mínimo ${RAZON_SOCIAL_MIN} caracteres.` })
  .max(RAZON_SOCIAL_MAX, { message: `Máximo ${RAZON_SOCIAL_MAX} caracteres.` });

const nombreFantasiaField = z
  .string()
  .trim()
  .min(NOMBRE_FANTASIA_MIN, { message: `Mínimo ${NOMBRE_FANTASIA_MIN} carácter.` })
  .max(NOMBRE_FANTASIA_MAX, { message: `Máximo ${NOMBRE_FANTASIA_MAX} caracteres.` });

const domicilioField = z
  .string()
  .trim()
  .min(DOMICILIO_MIN, { message: `Mínimo ${DOMICILIO_MIN} caracteres.` })
  .max(DOMICILIO_MAX, { message: `Máximo ${DOMICILIO_MAX} caracteres.` });

const localidadField = z
  .string()
  .trim()
  .min(LOCALIDAD_MIN, { message: `Mínimo ${LOCALIDAD_MIN} caracteres.` })
  .max(LOCALIDAD_MAX, { message: `Máximo ${LOCALIDAD_MAX} caracteres.` });

// Provincia: text libre (no enum) — el SQL CHECK solo restringe length <= 100.
// Razón: UI dropdown en T-049 garantiza valor válido en happy path, preserva
// futureproofing Fase 5 (tenants CL/UY no usan provincias AR).
const provinciaField = z
  .string()
  .trim()
  .min(1, { message: 'Provincia requerida si se completa.' })
  .max(PROVINCIA_MAX, { message: `Máximo ${PROVINCIA_MAX} caracteres.` });

const contactoNombreField = z
  .string()
  .trim()
  .min(CONTACTO_NOMBRE_MIN, { message: `Mínimo ${CONTACTO_NOMBRE_MIN} caracteres.` })
  .max(CONTACTO_NOMBRE_MAX, { message: `Máximo ${CONTACTO_NOMBRE_MAX} caracteres.` });

// Email: Zod más estricto que SQL CHECK permisivo (^[^@\s]+@[^@\s]+\.[^@\s]+$).
// Drift seguro al revés — ningún input válido en Zod rechazado por SQL.
const contactoEmailField = z.string().trim().email({ message: 'Email inválido.' });

const contactoTelefonoField = z
  .string()
  .trim()
  .min(CONTACTO_TELEFONO_MIN, { message: `Mínimo ${CONTACTO_TELEFONO_MIN} caracteres.` })
  .max(CONTACTO_TELEFONO_MAX, { message: `Máximo ${CONTACTO_TELEFONO_MAX} caracteres.` });

const industriaField = z
  .string()
  .trim()
  .min(1, { message: 'Industria requerida si se completa.' })
  .max(INDUSTRIA_MAX, { message: `Máximo ${INDUSTRIA_MAX} caracteres.` });

const artField = z
  .string()
  .trim()
  .min(1, { message: 'ART requerida si se completa.' })
  .max(ART_MAX, { message: `Máximo ${ART_MAX} caracteres.` });

const notasField = z
  .string()
  .trim()
  .max(NOTAS_MAX, { message: `Máximo ${NOTAS_MAX} caracteres.` });

export const createClienteSchema = z.object({
  razon_social: razonSocialField,
  cuit: cuitField,
  nombre_fantasia: nombreFantasiaField.optional(),
  domicilio: domicilioField.optional(),
  localidad: localidadField.optional(),
  provincia: provinciaField.optional(),
  contacto_nombre: contactoNombreField.optional(),
  contacto_email: contactoEmailField.optional(),
  contacto_telefono: contactoTelefonoField.optional(),
  industria: industriaField.optional(),
  art: artField.optional(),
  notas: notasField.optional(),
});

export const updateClientePatchSchema = z
  .object({
    razon_social: razonSocialField.optional(),
    cuit: cuitField.optional(),
    nombre_fantasia: nombreFantasiaField.nullable().optional(),
    domicilio: domicilioField.nullable().optional(),
    localidad: localidadField.nullable().optional(),
    provincia: provinciaField.nullable().optional(),
    contacto_nombre: contactoNombreField.nullable().optional(),
    contacto_email: contactoEmailField.nullable().optional(),
    contacto_telefono: contactoTelefonoField.nullable().optional(),
    industria: industriaField.nullable().optional(),
    art: artField.nullable().optional(),
    notas: notasField.nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, {
    message: 'Debe haber al menos un campo a actualizar.',
  });

export const clienteIdSchema = z.string().uuid({ message: 'UUID inválido.' });

export type CreateClienteInput = z.infer<typeof createClienteSchema>;
export type UpdateClientePatch = z.infer<typeof updateClientePatchSchema>;
