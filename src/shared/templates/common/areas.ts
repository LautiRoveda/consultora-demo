/**
 * T-022 · Presets de areas relevadas — compartido entre RGRL y relevamiento.
 *
 * Promovido desde `rgrl/schema.ts` (T-021). Ambos tipos lo usan en el form
 * (checkbox group + textarea libre). Centralizado para que extender el listado
 * no requiera tocar 2 schemas.
 */
export const AREAS_RELEVADAS_PRESETS = [
  'Oficinas administrativas',
  'Producción / planta',
  'Depósito / almacén',
  'Mantenimiento / taller',
  'Sala de máquinas',
  'Logística / expedición',
  'Áreas exteriores',
  'Servicios generales (comedor, sanitarios)',
] as const;
