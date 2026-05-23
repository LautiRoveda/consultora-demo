import { z } from 'zod';

// Bounds — matchean los CHECK SQL de T-100 (20260523000001_t100_epp_schema.sql)
// sin drift (1:1).
const CANTIDAD_MIN = 1;
const CANTIDAD_MAX = 100;
const NUMERO_SERIE_MIN = 1;
const NUMERO_SERIE_MAX = 80;
const MARCA_MAX = 80;
const MODELO_MAX = 80;
const VIDA_UTIL_MIN = 1;
const VIDA_UTIL_MAX = 60;
const OBSERVACIONES_MAX = 2000;
const MAX_ITEMS_PER_ENTREGA = 50;

const FIRMA_DATA_URL_PREFIX = 'data:image/png;base64,';

export const MOTIVO_ENTREGA_VALUES = [
  'inicial',
  'renovacion',
  'reposicion_rotura',
  'reposicion_perdida',
  'rotacion',
] as const;

export const motivoEntregaSchema = z.enum(MOTIVO_ENTREGA_VALUES);
export type MotivoEntrega = z.infer<typeof motivoEntregaSchema>;

const itemIdField = z.string().uuid({ message: 'Item inválido.' });
const empleadoIdField = z.string().uuid({ message: 'Empleado inválido.' });

const cantidadField = z
  .number()
  .int({ message: 'Cantidad debe ser entero.' })
  .min(CANTIDAD_MIN, { message: `Mínimo ${CANTIDAD_MIN}.` })
  .max(CANTIDAD_MAX, { message: `Máximo ${CANTIDAD_MAX}.` });

const numeroSerieField = z
  .string()
  .trim()
  .min(NUMERO_SERIE_MIN, { message: 'Número de serie vacío.' })
  .max(NUMERO_SERIE_MAX, { message: `Máximo ${NUMERO_SERIE_MAX} caracteres.` });

const marcaField = z
  .string()
  .trim()
  .min(1, { message: 'Marca vacía.' })
  .max(MARCA_MAX, { message: `Máximo ${MARCA_MAX} caracteres.` });

const modeloField = z
  .string()
  .trim()
  .min(1, { message: 'Modelo vacío.' })
  .max(MODELO_MAX, { message: `Máximo ${MODELO_MAX} caracteres.` });

const vidaUtilOverrideField = z
  .number()
  .int({ message: 'Debe ser un número entero.' })
  .min(VIDA_UTIL_MIN, { message: `Mínimo ${VIDA_UTIL_MIN}.` })
  .max(VIDA_UTIL_MAX, { message: `Máximo ${VIDA_UTIL_MAX}.` });

const observacionesField = z
  .string()
  .trim()
  .max(OBSERVACIONES_MAX, { message: `Máximo ${OBSERVACIONES_MAX} caracteres.` });

export const itemEntregaSchema = z.object({
  item_id: itemIdField,
  cantidad: cantidadField,
  numero_serie: numeroSerieField.optional(),
  marca_entregada: marcaField.optional(),
  modelo_entregado: modeloField.optional(),
  vida_util_meses_override: vidaUtilOverrideField.optional(),
  motivo_entrega: motivoEntregaSchema,
});

export const DEFAULT_MOTIVO_ENTREGA: MotivoEntrega = 'inicial';

export const createEntregaSchema = z.object({
  empleado_id: empleadoIdField,
  items: z
    .array(itemEntregaSchema)
    .min(1, { message: 'Agregá al menos un item.' })
    .max(MAX_ITEMS_PER_ENTREGA, { message: `Máximo ${MAX_ITEMS_PER_ENTREGA} items por entrega.` }),
  firma_base64: z
    .string()
    .min(1, { message: 'Firma obligatoria.' })
    .refine((s) => s.startsWith(FIRMA_DATA_URL_PREFIX), {
      message: 'Formato de firma inválido (debe ser PNG base64).',
    }),
  observaciones: observacionesField.optional(),
});

export type CreateEntregaInput = z.infer<typeof createEntregaSchema>;
export type ItemEntregaInput = z.infer<typeof itemEntregaSchema>;

export const ENTREGA_LIMITS = {
  MAX_ITEMS_PER_ENTREGA,
  CANTIDAD_MIN,
  CANTIDAD_MAX,
  VIDA_UTIL_MIN,
  VIDA_UTIL_MAX,
} as const;

export const FIRMA_DATA_URL = {
  PREFIX: FIRMA_DATA_URL_PREFIX,
} as const;
