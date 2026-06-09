import { z } from 'zod';

// Bounds — matchean los CHECK SQL de T-057 (20260603000001_t057_checklists.sql)
// sin drift (1:1). Sin `'use server'`: lo importan tanto las Server Actions como
// los forms del editor T-059 (resolver RHF).

const NOMBRE_MIN = 2;
const NOMBRE_MAX = 200;
const DESCRIPCION_MAX = 2000;
const TITULO_MIN = 1;
const TITULO_MAX = 200;
const ITEM_TEXTO_MIN = 1;
const ITEM_TEXTO_MAX = 1000;
const REFERENCIA_NORMATIVA_MAX = 300;
// config: el CHECK real es pg_column_size(config) <= 4096 (bytes en disco). Acá
// aproximamos con el largo del JSON serializado; la DB es la fuente de verdad.
const CONFIG_MAX_CHARS = 4096;

export const TIPO_INSPECCION_VALUES = ['rgrl_463_09', 'generico'] as const;
export const RESPONSE_TYPE_VALUES = ['cumple_no_aplica', 'si_no', 'texto', 'numerico'] as const;

export type TipoInspeccion = (typeof TIPO_INSPECCION_VALUES)[number];
export type ResponseType = (typeof RESPONSE_TYPE_VALUES)[number];

// ============================== Campos reusables ==============================

const uuidField = z.string().uuid({ message: 'UUID inválido.' });

const nombreField = z
  .string()
  .trim()
  .min(NOMBRE_MIN, { message: `Mínimo ${NOMBRE_MIN} caracteres.` })
  .max(NOMBRE_MAX, { message: `Máximo ${NOMBRE_MAX} caracteres.` });

const descripcionField = z
  .string()
  .trim()
  .max(DESCRIPCION_MAX, { message: `Máximo ${DESCRIPCION_MAX} caracteres.` });

const tituloField = z
  .string()
  .trim()
  .min(TITULO_MIN, { message: `Mínimo ${TITULO_MIN} carácter.` })
  .max(TITULO_MAX, { message: `Máximo ${TITULO_MAX} caracteres.` });

const itemTextoField = z
  .string()
  .trim()
  .min(ITEM_TEXTO_MIN, { message: `Mínimo ${ITEM_TEXTO_MIN} carácter.` })
  .max(ITEM_TEXTO_MAX, { message: `Máximo ${ITEM_TEXTO_MAX} caracteres.` });

const referenciaNormativaField = z
  .string()
  .trim()
  .max(REFERENCIA_NORMATIVA_MAX, { message: `Máximo ${REFERENCIA_NORMATIVA_MAX} caracteres.` });

// config jsonb reservado para C (escala/choices), NULL en MVP.
const configField = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= CONFIG_MAX_CHARS, {
    message: `config excede el tamaño máximo (${CONFIG_MAX_CHARS}).`,
  });

const tipoInspeccionField = z.enum(TIPO_INSPECCION_VALUES, {
  message: 'Tipo de inspección inválido.',
});

const responseTypeField = z.enum(RESPONSE_TYPE_VALUES, {
  message: 'Tipo de respuesta inválido.',
});

// ============================== Templates ==============================

export const createChecklistTemplateSchema = z.object({
  nombre: nombreField,
  descripcion: descripcionField.optional(),
  tipo_inspeccion: tipoInspeccionField.default('rgrl_463_09'),
});

export const cloneSystemTemplateSchema = z.object({
  systemTemplateId: uuidField,
  // override opcional del nombre; si se omite, la action computa uno libre con sufijo.
  nombre: nombreField.optional(),
});

export const editPublishedTemplateSchema = z.object({ templateId: uuidField });
export const archiveTemplateSchema = z.object({ templateId: uuidField });
export const restoreTemplateSchema = z.object({ templateId: uuidField });
export const publishVersionSchema = z.object({ versionId: uuidField });

// Edita la meta del template (nombre/descripcion/tipo) — vive en checklist_templates,
// no en la versión. Patch parcial con ≥1 campo (igual que update section/item).
export const updateTemplateMetaSchema = z
  .object({
    templateId: uuidField,
    nombre: nombreField.optional(),
    descripcion: descripcionField.nullable().optional(),
    tipo_inspeccion: tipoInspeccionField.optional(),
  })
  .refine(
    (p) => p.nombre !== undefined || p.descripcion !== undefined || p.tipo_inspeccion !== undefined,
    { message: 'Debe haber al menos un campo a actualizar.' },
  );

// ============================== Sections ==============================

export const addSectionSchema = z.object({
  versionId: uuidField,
  titulo: tituloField,
  descripcion: descripcionField.optional(),
});

export const updateSectionSchema = z
  .object({
    sectionId: uuidField,
    titulo: tituloField.optional(),
    descripcion: descripcionField.nullable().optional(),
  })
  .refine((p) => p.titulo !== undefined || p.descripcion !== undefined, {
    message: 'Debe haber al menos un campo a actualizar.',
  });

export const deleteSectionSchema = z.object({ sectionId: uuidField });

// ============================== Items ==============================

export const addItemSchema = z.object({
  sectionId: uuidField,
  texto: itemTextoField,
  response_type: responseTypeField.default('cumple_no_aplica'),
  es_critico: z.boolean().default(false),
  es_requerido: z.boolean().default(true),
  referencia_normativa: referenciaNormativaField.optional(),
  config: configField.optional(),
});

export const updateItemSchema = z
  .object({
    itemId: uuidField,
    texto: itemTextoField.optional(),
    response_type: responseTypeField.optional(),
    es_critico: z.boolean().optional(),
    es_requerido: z.boolean().optional(),
    referencia_normativa: referenciaNormativaField.nullable().optional(),
    config: configField.nullable().optional(),
  })
  .refine(
    (p) =>
      p.texto !== undefined ||
      p.response_type !== undefined ||
      p.es_critico !== undefined ||
      p.es_requerido !== undefined ||
      p.referencia_normativa !== undefined ||
      p.config !== undefined,
    { message: 'Debe haber al menos un campo a actualizar.' },
  );

export const deleteItemSchema = z.object({ itemId: uuidField });

// ============================== Reorder (T-059) ==============================
// La UI manda el ARRAY COMPLETO reordenado de ids; la RPC two-phase reasigna
// `orden` a 0..N-1 sin violar el índice único non-deferrable.

const orderedIdsField = z
  .array(uuidField)
  .min(1, { message: 'La lista de orden no puede estar vacía.' });

export const reorderSectionsSchema = z.object({
  versionId: uuidField,
  orderedIds: orderedIdsField,
});

export const reorderItemsSchema = z.object({
  sectionId: uuidField,
  orderedIds: orderedIdsField,
});

// ============================== Tipos inferidos ==============================

export type CreateChecklistTemplateInput = z.infer<typeof createChecklistTemplateSchema>;
export type CloneSystemTemplateInput = z.infer<typeof cloneSystemTemplateSchema>;
export type UpdateTemplateMetaInput = z.infer<typeof updateTemplateMetaSchema>;
export type AddSectionInput = z.infer<typeof addSectionSchema>;
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
export type AddItemInput = z.infer<typeof addItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type ReorderSectionsInput = z.infer<typeof reorderSectionsSchema>;
export type ReorderItemsInput = z.infer<typeof reorderItemsSchema>;
