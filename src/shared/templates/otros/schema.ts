import { z } from 'zod';

import {
  camposPersonalizadosField,
  instruccionesAdicionalesField,
  normalizeCamposPersonalizados,
  normalizeInstruccionesAdicionales,
} from '../common/campos-extra';
import { normalizeCuit } from '../common/cuit';
import { commonClientFields } from '../common/schema';
import { normalizeSecciones, seccionesField } from '../common/secciones';
import { SECCION_IDS_OTROS } from './secciones';

/**
 * T-022 · Schema del template "Otros" (tipo wildcard).
 *
 * 4 campos minimos. Defendido vs no-form (decision Q11.a) — sin form, el LLM
 * vuelve con `[A COMPLETAR]` en razon social y eso rompe la promesa T-021 de
 * "output 80-90% completo". El form minimal da identificacion cliente + tema
 * + objetivos libres para que el LLM tenga un anclaje minimo.
 *
 * Notar: NO usamos `commonClientFields()` completo aca — solo razon_social
 * y cuit (sin domicilio). Para "otros" wildcard el domicilio puede no aplicar
 * (ej. nota de descargo, auditoria de sistema), no lo forzamos.
 */

// =============================================================================
// SCHEMA PRINCIPAL
// =============================================================================

const baseFields = commonClientFields();

export const otrosMetadataSchema = z.object({
  // — IDENTIFICACION CLIENTE (razon_social + cuit, sin domicilio) —
  razon_social: baseFields.razon_social,
  cuit: baseFields.cuit,

  // — SOLICITUD —
  tema_informe: z
    .string()
    .trim()
    .min(3, { message: 'Mínimo 3 caracteres.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),

  /** Opcional. Contexto libre que orienta al LLM sobre estructura y profundidad. */
  objetivos: z.string().trim().max(2000, { message: 'Máximo 2000 caracteres.' }).optional(),

  // — PERSONALIZACION (T-138 fase 1, compartida por los 5 tipos) —
  campos_personalizados: camposPersonalizadosField(),
  instrucciones_adicionales: instruccionesAdicionalesField(),

  // — SECCIONES CONFIGURABLES (T-138 fase 2, solo tipos sin estructura legal) —
  secciones: seccionesField(SECCION_IDS_OTROS),
});

export type OtrosMetadata = z.infer<typeof otrosMetadataSchema>;

// =============================================================================
// NORMALIZADOR
// =============================================================================

export function normalizeOtrosMetadata(m: OtrosMetadata): OtrosMetadata {
  return {
    ...m,
    cuit: normalizeCuit(m.cuit),
    objetivos: m.objetivos && m.objetivos.length > 0 ? m.objetivos : undefined,
    campos_personalizados: normalizeCamposPersonalizados(m.campos_personalizados),
    instrucciones_adicionales: normalizeInstruccionesAdicionales(m.instrucciones_adicionales),
    secciones: normalizeSecciones(m.secciones, SECCION_IDS_OTROS),
  };
}
