import { z } from 'zod';

/**
 * T-143 · RAR Fase 1 — schemas Zod del catálogo de agentes de riesgo y de la
 * exposición puesto×agente.
 *
 * Bounds 1:1 con los CHECK de la migración
 * `20260613000001_t143_rar_agentes_exposicion.sql` (rar_agentes):
 *   codigo 2-60 · nombre 2-120 · cas ≤40 · enfermedad_asociada ≤200 ·
 *   descripcion ≤500. Si cambia el CHECK, cambiar acá (lo cubre el unit test
 *   `t143-schema.test.ts`).
 */

// Fuente de verdad TS del enum agente_riesgo_tipo. El test-meta
// `t143-agente-tipo-sql-sync.test.ts` valida que coincida con el enum SQL.
export const AGENTE_TIPOS = ['fisico', 'quimico', 'biologico', 'ergonomico'] as const;
export type AgenteTipo = (typeof AGENTE_TIPOS)[number];

const CODIGO_MIN = 2;
const CODIGO_MAX = 60;
const NOMBRE_MIN = 2;
const NOMBRE_MAX = 120;
const CAS_MAX = 40;
const ENFERMEDAD_MAX = 200;
const DESCRIPCION_MAX = 500;

const codigoField = z
  .string()
  .trim()
  .min(CODIGO_MIN, { message: `Mínimo ${CODIGO_MIN} caracteres.` })
  .max(CODIGO_MAX, { message: `Máximo ${CODIGO_MAX} caracteres.` });

const nombreField = z
  .string()
  .trim()
  .min(NOMBRE_MIN, { message: `Mínimo ${NOMBRE_MIN} caracteres.` })
  .max(NOMBRE_MAX, { message: `Máximo ${NOMBRE_MAX} caracteres.` });

const agenteTipoField = z.enum(AGENTE_TIPOS, {
  message: 'Tipo de agente inválido.',
});

const casField = z
  .string()
  .trim()
  .max(CAS_MAX, { message: `Máximo ${CAS_MAX} caracteres.` });

const enfermedadField = z
  .string()
  .trim()
  .max(ENFERMEDAD_MAX, { message: `Máximo ${ENFERMEDAD_MAX} caracteres.` });

const descripcionField = z
  .string()
  .trim()
  .max(DESCRIPCION_MAX, { message: `Máximo ${DESCRIPCION_MAX} caracteres.` });

export const createAgenteSchema = z.object({
  codigo: codigoField,
  nombre: nombreField,
  agente_tipo: agenteTipoField,
  cas: casField.optional(),
  enfermedad_asociada: enfermedadField.optional(),
  descripcion: descripcionField.optional(),
});

export const updateAgentePatchSchema = z
  .object({
    codigo: codigoField.optional(),
    nombre: nombreField.optional(),
    agente_tipo: agenteTipoField.optional(),
    cas: casField.nullable().optional(),
    enfermedad_asociada: enfermedadField.nullable().optional(),
    descripcion: descripcionField.nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, {
    message: 'Debe haber al menos un campo a actualizar.',
  });

export const assignAgenteSchema = z.object({
  puesto_id: z.string().uuid({ message: 'puesto_id inválido.' }),
  agente_id: z.string().uuid({ message: 'agente_id inválido.' }),
});

export const removeAgenteSchema = assignAgenteSchema;

export const entityIdSchema = z.string().uuid({ message: 'UUID inválido.' });

export type CreateAgenteInput = z.infer<typeof createAgenteSchema>;
export type UpdateAgentePatch = z.infer<typeof updateAgentePatchSchema>;
export type AssignAgenteInput = z.infer<typeof assignAgenteSchema>;
export type RemoveAgenteInput = z.infer<typeof removeAgenteSchema>;
