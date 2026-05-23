import { z } from 'zod';

// Bounds — matchean los CHECK SQL de T-100 (20260523000001_t100_epp_schema.sql)
// sin drift (1:1).
const CATEGORIA_NOMBRE_MIN = 2;
const CATEGORIA_NOMBRE_MAX = 80;
const CATEGORIA_DESC_MAX = 500;

const ITEM_NOMBRE_MIN = 2;
const ITEM_NOMBRE_MAX = 120;
const ITEM_MARCA_MAX = 80;
const ITEM_MODELO_MAX = 80;
const ITEM_NORMATIVA_MAX = 200;
const ITEM_NOTAS_MAX = 2000;
const VIDA_UTIL_MIN = 1;
const VIDA_UTIL_MAX = 60;

const PUESTO_NOMBRE_MIN = 2;
const PUESTO_NOMBRE_MAX = 80;
const PUESTO_DESC_MAX = 500;
const RIESGO_MIN = 1;
const RIESGO_MAX = 60;
const RIESGOS_MAX_ITEMS = 50;

// ============================ CATEGORIAS ====================================

const categoriaNombreField = z
  .string()
  .trim()
  .min(CATEGORIA_NOMBRE_MIN, { message: `Mínimo ${CATEGORIA_NOMBRE_MIN} caracteres.` })
  .max(CATEGORIA_NOMBRE_MAX, { message: `Máximo ${CATEGORIA_NOMBRE_MAX} caracteres.` });

const categoriaDescripcionField = z
  .string()
  .trim()
  .max(CATEGORIA_DESC_MAX, { message: `Máximo ${CATEGORIA_DESC_MAX} caracteres.` });

export const createCategoriaSchema = z.object({
  nombre: categoriaNombreField,
  descripcion: categoriaDescripcionField.optional(),
});

export const updateCategoriaPatchSchema = z
  .object({
    nombre: categoriaNombreField.optional(),
    descripcion: categoriaDescripcionField.nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, {
    message: 'Debe haber al menos un campo a actualizar.',
  });

// ============================ ITEMS =========================================

const itemNombreField = z
  .string()
  .trim()
  .min(ITEM_NOMBRE_MIN, { message: `Mínimo ${ITEM_NOMBRE_MIN} caracteres.` })
  .max(ITEM_NOMBRE_MAX, { message: `Máximo ${ITEM_NOMBRE_MAX} caracteres.` });

const categoriaIdField = z.string().uuid({ message: 'Categoría inválida.' });

const vidaUtilField = z
  .number()
  .int({ message: 'Debe ser un número entero.' })
  .min(VIDA_UTIL_MIN, { message: `Mínimo ${VIDA_UTIL_MIN} mes.` })
  .max(VIDA_UTIL_MAX, { message: `Máximo ${VIDA_UTIL_MAX} meses.` });

const marcaField = z
  .string()
  .trim()
  .min(1, { message: 'Marca vacía.' })
  .max(ITEM_MARCA_MAX, { message: `Máximo ${ITEM_MARCA_MAX} caracteres.` });

const modeloField = z
  .string()
  .trim()
  .min(1, { message: 'Modelo vacío.' })
  .max(ITEM_MODELO_MAX, { message: `Máximo ${ITEM_MODELO_MAX} caracteres.` });

const normativaField = z
  .string()
  .trim()
  .max(ITEM_NORMATIVA_MAX, { message: `Máximo ${ITEM_NORMATIVA_MAX} caracteres.` });

const notasField = z
  .string()
  .trim()
  .max(ITEM_NOTAS_MAX, { message: `Máximo ${ITEM_NOTAS_MAX} caracteres.` });

export const createItemSchema = z.object({
  nombre: itemNombreField,
  categoria_id: categoriaIdField,
  vida_util_meses: vidaUtilField.default(6),
  es_descartable: z.boolean().default(false),
  requiere_numero_serie: z.boolean().default(false),
  marca_default: marcaField.optional(),
  modelo_default: modeloField.optional(),
  normativa: normativaField.optional(),
  notas: notasField.optional(),
});

export const updateItemPatchSchema = z
  .object({
    nombre: itemNombreField.optional(),
    categoria_id: categoriaIdField.optional(),
    vida_util_meses: vidaUtilField.optional(),
    es_descartable: z.boolean().optional(),
    requiere_numero_serie: z.boolean().optional(),
    marca_default: marcaField.nullable().optional(),
    modelo_default: modeloField.nullable().optional(),
    normativa: normativaField.nullable().optional(),
    notas: notasField.nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, {
    message: 'Debe haber al menos un campo a actualizar.',
  });

// ============================ PUESTOS =======================================

const puestoNombreField = z
  .string()
  .trim()
  .min(PUESTO_NOMBRE_MIN, { message: `Mínimo ${PUESTO_NOMBRE_MIN} caracteres.` })
  .max(PUESTO_NOMBRE_MAX, { message: `Máximo ${PUESTO_NOMBRE_MAX} caracteres.` });

const puestoDescripcionField = z
  .string()
  .trim()
  .max(PUESTO_DESC_MAX, { message: `Máximo ${PUESTO_DESC_MAX} caracteres.` });

const riesgoTagField = z
  .string()
  .trim()
  .min(RIESGO_MIN, { message: 'Tag vacío.' })
  .max(RIESGO_MAX, { message: `Tag máx ${RIESGO_MAX} caracteres.` });

const riesgosArrayField = z
  .array(riesgoTagField)
  .max(RIESGOS_MAX_ITEMS, { message: `Máximo ${RIESGOS_MAX_ITEMS} tags.` });

export const createPuestoSchema = z.object({
  nombre: puestoNombreField,
  descripcion: puestoDescripcionField.optional(),
  riesgos_asociados: riesgosArrayField.optional(),
});

export const updatePuestoPatchSchema = z
  .object({
    nombre: puestoNombreField.optional(),
    descripcion: puestoDescripcionField.nullable().optional(),
    riesgos_asociados: riesgosArrayField.nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, {
    message: 'Debe haber al menos un campo a actualizar.',
  });

// ============================ COMMON ========================================

export const entityIdSchema = z.string().uuid({ message: 'UUID inválido.' });

export type CreateCategoriaInput = z.infer<typeof createCategoriaSchema>;
export type UpdateCategoriaPatch = z.infer<typeof updateCategoriaPatchSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemPatch = z.infer<typeof updateItemPatchSchema>;
export type CreatePuestoInput = z.infer<typeof createPuestoSchema>;
export type UpdatePuestoPatch = z.infer<typeof updatePuestoPatchSchema>;
