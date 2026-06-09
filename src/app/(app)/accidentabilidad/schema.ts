import { z } from 'zod';

import { HORA_HHMM_REGEX } from '@/shared/templates/common/sanitize';
import { fechaIsoField } from '@/shared/templates/common/schema';

/**
 * T-062 · Schemas Zod del libro de incidentes (módulo Accidentabilidad).
 *
 * SIN 'use server' — se importa desde la action (server) y desde el form de
 * alta (client, T-063) como resolver de RHF.
 *
 * Bounds matchean los CHECK SQL de `20260602000001_t062_incidentes.sql` 1:1.
 * Las reglas condicionales por tipo (superRefine) replican en el borde el CHECK
 * `incidentes_gravedad_por_tipo` de la DB:
 *   - accidente      → gravedad obligatoria.
 *   - casi_accidente → sin gravedad ni dias_perdidos (no hubo lesión).
 */

// ============ Constantes (1:1 con CHECK SQL) ============
const LUGAR_MIN = 3;
const LUGAR_MAX = 200;
const DESCRIPCION_MIN = 10;
const DESCRIPCION_MAX = 4000;
const CAUSA_RAIZ_MAX = 4000;
const ACCION_INMEDIATA_MAX = 2000;
const DIAS_PERDIDOS_MIN = 0;
const DIAS_PERDIDOS_MAX = 3650;
const MOTIVO_ANULACION_MIN = 5;
const MOTIVO_ANULACION_MAX = 2000;

// ============ Enums (espejo de los enums SQL) ============

export const TIPO_INCIDENTE = [
  { value: 'casi_accidente', label: 'Casi-accidente (sin lesión)' },
  { value: 'accidente', label: 'Accidente (con lesión)' },
] as const;
export type TipoIncidente = (typeof TIPO_INCIDENTE)[number]['value'];
const TIPO_INCIDENTE_VALUES = ['casi_accidente', 'accidente'] as const;

export const GRAVEDAD_INCIDENTE = [
  { value: 'leve', label: 'Leve (sin baja prolongada)' },
  { value: 'grave', label: 'Grave (baja prolongada)' },
  { value: 'mortal', label: 'Mortal (fatalidad)' },
] as const;
export type GravedadIncidente = (typeof GRAVEDAD_INCIDENTE)[number]['value'];
const GRAVEDAD_VALUES = ['leve', 'grave', 'mortal'] as const;

// ============ Lookups de label ============

const TIPO_INCIDENTE_LABEL_BY_VALUE: Record<TipoIncidente, string> = Object.fromEntries(
  TIPO_INCIDENTE.map((t) => [t.value, t.label]),
) as Record<TipoIncidente, string>;

export function tipoIncidenteLabel(value: TipoIncidente): string {
  return TIPO_INCIDENTE_LABEL_BY_VALUE[value];
}

const GRAVEDAD_LABEL_BY_VALUE: Record<GravedadIncidente, string> = Object.fromEntries(
  GRAVEDAD_INCIDENTE.map((g) => [g.value, g.label]),
) as Record<GravedadIncidente, string>;

export function gravedadIncidenteLabel(value: GravedadIncidente): string {
  return GRAVEDAD_LABEL_BY_VALUE[value];
}

// ============ Fields ============

const uuidField = z.string().uuid({ message: 'UUID inválido.' });

// fecha ISO YYYY-MM-DD (regex + Date.parse via fechaIsoField) + no futuro.
// La regla "no futuro" es de negocio — la DB no la enforce (un incidente se
// carga el día del hecho o después, nunca con fecha futura).
const fechaNoFuturoField = fechaIsoField.refine((v) => v <= new Date().toISOString().slice(0, 10), {
  message: 'La fecha no puede ser futura.',
});

const horaField = z.string().regex(HORA_HHMM_REGEX, { message: 'Formato HH:MM (24h).' });

const lugarField = z
  .string()
  .trim()
  .min(LUGAR_MIN, { message: `Mínimo ${LUGAR_MIN} caracteres.` })
  .max(LUGAR_MAX, { message: `Máximo ${LUGAR_MAX} caracteres.` });

const descripcionField = z
  .string()
  .trim()
  .min(DESCRIPCION_MIN, { message: `Mínimo ${DESCRIPCION_MIN} caracteres — describí qué pasó.` })
  .max(DESCRIPCION_MAX, { message: `Máximo ${DESCRIPCION_MAX} caracteres.` });

const causaRaizField = z
  .string()
  .trim()
  .min(1, { message: 'Causa raíz requerida si se completa.' })
  .max(CAUSA_RAIZ_MAX, { message: `Máximo ${CAUSA_RAIZ_MAX} caracteres.` });

const accionInmediataField = z
  .string()
  .trim()
  .min(1, { message: 'Acción inmediata requerida si se completa.' })
  .max(ACCION_INMEDIATA_MAX, { message: `Máximo ${ACCION_INMEDIATA_MAX} caracteres.` });

const diasPerdidosField = z
  .number({ message: 'Ingresá un número de días.' })
  .int({ message: 'Debe ser un número entero de días.' })
  .min(DIAS_PERDIDOS_MIN, { message: `Mínimo ${DIAS_PERDIDOS_MIN} días.` })
  .max(DIAS_PERDIDOS_MAX, { message: `Máximo ${DIAS_PERDIDOS_MAX} días.` });

// ============ Shape base + refinamiento condicional ============

const incidenteBaseShape = {
  tipo: z.enum(TIPO_INCIDENTE_VALUES, { message: 'Elegí el tipo de incidente.' }),
  fecha: fechaNoFuturoField,
  hora: horaField.optional(),
  cliente_id: uuidField.optional(),
  empleado_id: uuidField.optional(),
  lugar_especifico: lugarField.optional(),
  descripcion: descripcionField,
  causa_raiz: causaRaizField.optional(),
  accion_inmediata: accionInmediataField.optional(),
  gravedad: z.enum(GRAVEDAD_VALUES, { message: 'Elegí una gravedad.' }).optional(),
  dias_perdidos: diasPerdidosField.optional(),
  informe_id: uuidField.optional(),
};

type IncidenteBaseValues = {
  tipo: TipoIncidente;
  gravedad?: GravedadIncidente;
  dias_perdidos?: number;
};

function refineTipoVsLesion(val: IncidenteBaseValues, ctx: z.RefinementCtx): void {
  if (val.tipo === 'accidente') {
    if (!val.gravedad) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gravedad'],
        message: 'Gravedad requerida para un accidente con lesión.',
      });
    }
  } else {
    // casi_accidente: no hubo lesión → sin gravedad ni días perdidos.
    if (val.gravedad) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gravedad'],
        message: 'Un casi-accidente no lleva gravedad (no hubo lesión).',
      });
    }
    if (val.dias_perdidos != null && val.dias_perdidos !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dias_perdidos'],
        message: 'Un casi-accidente no lleva días perdidos (no hubo lesión).',
      });
    }
  }
}

export const createIncidenteSchema = z.object(incidenteBaseShape).superRefine(refineTipoVsLesion);

export const corregirIncidenteSchema = z
  .object({ ...incidenteBaseShape, corrige_id: uuidField })
  .superRefine(refineTipoVsLesion);

export const anularIncidenteSchema = z.object({
  id: uuidField,
  motivo: z
    .string()
    .trim()
    .min(MOTIVO_ANULACION_MIN, { message: `Mínimo ${MOTIVO_ANULACION_MIN} caracteres.` })
    .max(MOTIVO_ANULACION_MAX, { message: `Máximo ${MOTIVO_ANULACION_MAX} caracteres.` }),
});

export const incidenteIdSchema = uuidField;

export type CreateIncidenteInput = z.infer<typeof createIncidenteSchema>;
export type CorregirIncidenteInput = z.infer<typeof corregirIncidenteSchema>;
export type AnularIncidenteInput = z.infer<typeof anularIncidenteSchema>;
