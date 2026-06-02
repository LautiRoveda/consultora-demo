import type { GravedadIncidente, TipoIncidente } from './schema';

/**
 * T-063 · Helpers de presentación del libro de incidentes.
 *
 * Re-exporta los labels de enums de `schema.ts` (fuente única) + define las
 * variantes de Badge por tipo/gravedad. Formateadores de fecha vienen del
 * helper centralizado TZ AR (`format-date`).
 */

export { gravedadIncidenteLabel, tipoIncidenteLabel } from './schema';
export { formatCivilDateShortAR, formatCivilDateLongAR } from '@/shared/lib/format-date';
export { formatDateShortAR as formatTimestampEs } from '@/shared/lib/format-date';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/** Accidente (con lesión) destaca; casi-accidente queda neutro. */
export function tipoBadgeVariant(tipo: TipoIncidente): BadgeVariant {
  return tipo === 'accidente' ? 'default' : 'outline';
}

/** Escala de severidad: leve → neutro, grave → destacado, mortal → alarma. */
export function gravedadBadgeVariant(gravedad: GravedadIncidente): BadgeVariant {
  switch (gravedad) {
    case 'mortal':
      return 'destructive';
    case 'grave':
      return 'default';
    case 'leve':
      return 'secondary';
  }
}
