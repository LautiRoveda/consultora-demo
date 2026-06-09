import { z } from 'zod';

/**
 * T-060a · Schemas Zod del flujo de ejecución de inspecciones.
 *
 * Bounds 1:1 con los CHECK de T-057 (20260603000001_t057_checklists.sql). Sin
 * `'use server'`: lo importan las Server Actions y (a futuro T-061) los forms.
 * La respuesta es una DISCRIMINATED UNION por `response_type` — el client manda
 * el tipo del ítem y el action lo cruza contra el `response_type` real del ítem
 * (defensa anti-form-stale).
 */

// Espejo de execution_respuestas / checklist_executions CHECK bounds.
const VALOR_MAX = 2000;
const OBSERVACION_MAX = 2000;
const FIRMANTE_NOMBRE_MAX = 200;
const FIRMANTE_MATRICULA_MAX = 80;

export const CUMPLE_NO_APLICA_VALUES = ['si', 'no', 'na'] as const;
export const SI_NO_VALUES = ['si', 'no'] as const;

const uuidField = z.string().uuid({ message: 'UUID inválido.' });
const fechaField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Fecha inválida (YYYY-MM-DD).' });
const observacionField = z
  .string()
  .trim()
  .max(OBSERVACION_MAX, { message: `Máximo ${OBSERVACION_MAX} caracteres.` })
  .optional();

// ============================== Crear borrador ==============================

export const createEjecucionSchema = z.object({
  // Se resuelve la última versión PUBLICADA del template (sistema o del tenant).
  templateId: uuidField,
  clienteId: uuidField,
});

// ============================== Auto-save de respuesta ==============================
// Discriminada por response_type. `valor` nullable = limpiar la respuesta (auto-save
// de "sin responder"). El action valida que el ítem realmente tenga ese response_type.

const respuestaBase = { executionId: uuidField, templateItemId: uuidField };

export const saveRespuestaSchema = z.discriminatedUnion('response_type', [
  z.object({
    ...respuestaBase,
    response_type: z.literal('cumple_no_aplica'),
    valor: z.enum(CUMPLE_NO_APLICA_VALUES, { message: 'Valor inválido.' }).nullable(),
    observacion: observacionField,
    // Solo relevante en valor='no'; el cierre la usa como fecha_compromiso de la CAPA.
    fecha_regularizacion: fechaField.nullable().optional(),
  }),
  z.object({
    ...respuestaBase,
    response_type: z.literal('si_no'),
    valor: z.enum(SI_NO_VALUES, { message: 'Valor inválido.' }).nullable(),
    observacion: observacionField,
  }),
  z.object({
    ...respuestaBase,
    response_type: z.literal('texto'),
    valor: z
      .string()
      .trim()
      .max(VALOR_MAX, { message: `Máximo ${VALOR_MAX} caracteres.` })
      .nullable(),
    observacion: observacionField,
  }),
  z.object({
    ...respuestaBase,
    response_type: z.literal('numerico'),
    valor_numerico: z.number().finite({ message: 'Número inválido.' }).nullable(),
    observacion: observacionField,
  }),
]);

// ============================== Adjuntos (fotos) ==============================

export const uploadAdjuntoSchema = z.object({
  executionId: uuidField,
  // Hallazgo puntual al que se ata la foto (opcional).
  respuestaId: uuidField.optional(),
  // data URL: el action decodifica + valida magic-bytes + tamaño.
  dataUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp);base64,/, { message: 'La imagen debe ser PNG/JPG/WEBP.' }),
});

export const deleteAdjuntoSchema = z.object({ adjuntoId: uuidField });

// ============================== Cierre + firma ==============================

export const cerrarEjecucionSchema = z.object({
  executionId: uuidField,
  firma_base64: z
    .string()
    .startsWith('data:image/png;base64,', { message: 'Firma inválida. Volvé a firmar.' }),
  firmante_nombre: z
    .string()
    .trim()
    .min(1, { message: 'El nombre del firmante es obligatorio.' })
    .max(FIRMANTE_NOMBRE_MAX, { message: `Máximo ${FIRMANTE_NOMBRE_MAX} caracteres.` }),
  firmante_matricula: z
    .string()
    .trim()
    .max(FIRMANTE_MATRICULA_MAX, { message: `Máximo ${FIRMANTE_MATRICULA_MAX} caracteres.` })
    .optional(),
  // Si se omite, el cierre usa la fecha de inspección existente o la de cierre.
  fecha_inspeccion: fechaField.optional(),
  gps_lat: z.number().min(-90).max(90).optional(),
  gps_lng: z.number().min(-180).max(180).optional(),
});

// ============================== Anular (T-060b) ==============================

export const anularEjecucionSchema = z.object({
  executionId: uuidField,
  // Motivo opcional: va al logger/audit (no hay columna en checklist_executions).
  motivo: z.string().trim().max(2000, { message: 'Máximo 2000 caracteres.' }).optional(),
});

// ============================== Resolver CAPA (cierre con evidencia · T-120) ==============================
// Cierre "natural" de una acción correctiva regularizada desde la ficha de inspección.
// evidencia_cierre OBLIGATORIA (decisión owner): 5–2000 chars; el 2000 es 1:1 con el
// CHECK evidencia_cierre <= 2000 de T-057. El min 5 espeja el `motivo` de anular.

const EVIDENCIA_CIERRE_MIN = 5;
const EVIDENCIA_CIERRE_MAX = 2000;

export const resolverCapaSchema = z.object({
  capaId: uuidField,
  evidencia_cierre: z
    .string()
    .trim()
    .min(EVIDENCIA_CIERRE_MIN, { message: `Mínimo ${EVIDENCIA_CIERRE_MIN} caracteres.` })
    .max(EVIDENCIA_CIERRE_MAX, { message: `Máximo ${EVIDENCIA_CIERRE_MAX} caracteres.` }),
});

// ============================== Tipos inferidos ==============================

export type CreateEjecucionInput = z.infer<typeof createEjecucionSchema>;
export type SaveRespuestaInput = z.infer<typeof saveRespuestaSchema>;
export type UploadAdjuntoInput = z.infer<typeof uploadAdjuntoSchema>;
export type CerrarEjecucionInput = z.infer<typeof cerrarEjecucionSchema>;
export type AnularEjecucionInput = z.infer<typeof anularEjecucionSchema>;
export type ResolverCapaInput = z.infer<typeof resolverCapaSchema>;
