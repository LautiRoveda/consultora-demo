import { z } from 'zod';

import { cuitField } from '@/shared/templates/common/cuit';
import { dniField } from '@/shared/templates/common/dni';

// Bounds — matchean los CHECK SQL de T-052 (20260519114309_empleados.sql) sin drift (1:1).
const NOMBRE_MIN = 2;
const NOMBRE_MAX = 80;
const APELLIDO_MIN = 2;
const APELLIDO_MAX = 80;
const TELEFONO_MIN = 6;
const TELEFONO_MAX = 30;
const NOTAS_MAX = 2000;

const nombreField = z
  .string()
  .trim()
  .min(NOMBRE_MIN, { message: `Mínimo ${NOMBRE_MIN} caracteres.` })
  .max(NOMBRE_MAX, { message: `Máximo ${NOMBRE_MAX} caracteres.` });

const apellidoField = z
  .string()
  .trim()
  .min(APELLIDO_MIN, { message: `Mínimo ${APELLIDO_MIN} caracteres.` })
  .max(APELLIDO_MAX, { message: `Máximo ${APELLIDO_MAX} caracteres.` });

// DNI: aceptamos input permisivo (con puntos, espacios o guiones) que la action
// canonicaliza a digits-only pre-INSERT matcheando CHECK SQL `^\d{7,8}$`.
// `dniField` vive en `shared/templates/common/dni.ts` (T-054) — reusamos para
// que UI + actions + queries compartan la misma regla.

// CUIL formato matchea CUIT 1:1 — reusamos `cuitField` de common/cuit.ts.
// La action normaliza con `normalizeCuit()` pre-INSERT (con o sin guiones).

// Email: Zod más estricto que SQL CHECK permisivo (^[^@\s]+@[^@\s]+\.[^@\s]+$).
// Drift seguro al revés — ningún input válido en Zod rechazado por SQL.
const emailField = z.string().trim().email({ message: 'Email inválido.' });

const telefonoField = z
  .string()
  .trim()
  .min(TELEFONO_MIN, { message: `Mínimo ${TELEFONO_MIN} caracteres.` })
  .max(TELEFONO_MAX, { message: `Máximo ${TELEFONO_MAX} caracteres.` });

// T-128 · El "puesto" del empleado es el del catálogo estructurado (tabla
// `puestos`, vía join `empleados_puestos`). El form envía `puesto_id` (uuid del
// catálogo); la action valida y materializa la asignación en `empleados_puestos`.
// El texto libre ya no es un input válido.
const puestoIdField = z.string().uuid({ message: 'Puesto inválido.' });

const notasField = z
  .string()
  .trim()
  .max(NOTAS_MAX, { message: `Máximo ${NOTAS_MAX} caracteres.` });

// Fecha ISO YYYY-MM-DD (CHECK SQL es `date`, accepta este formato).
const fechaIsoField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato fecha: YYYY-MM-DD.' });

const clienteIdField = z.string().uuid({ message: 'cliente_id inválido (UUID).' });

export const createEmpleadoSchema = z.object({
  cliente_id: clienteIdField,
  nombre: nombreField,
  apellido: apellidoField,
  dni: dniField,
  cuil: cuitField.optional(),
  email: emailField.optional(),
  telefono: telefonoField.optional(),
  puesto_id: puestoIdField.optional(),
  fecha_ingreso: fechaIsoField.optional(),
  fecha_nacimiento: fechaIsoField.optional(),
  notas: notasField.optional(),
});

export const updateEmpleadoPatchSchema = z
  .object({
    nombre: nombreField.optional(),
    apellido: apellidoField.optional(),
    dni: dniField.optional(),
    cuil: cuitField.nullable().optional(),
    email: emailField.nullable().optional(),
    telefono: telefonoField.nullable().optional(),
    puesto_id: puestoIdField.nullable().optional(),
    fecha_ingreso: fechaIsoField.nullable().optional(),
    fecha_nacimiento: fechaIsoField.nullable().optional(),
    notas: notasField.nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, {
    message: 'Debe haber al menos un campo a actualizar.',
  });

export const empleadoIdSchema = z.string().uuid({ message: 'UUID inválido.' });

export type CreateEmpleadoInput = z.infer<typeof createEmpleadoSchema>;
export type UpdateEmpleadoPatch = z.infer<typeof updateEmpleadoPatchSchema>;
