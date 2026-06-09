import type { ResponseType, TipoInspeccion } from './schema';

// Labels de display para los enums del módulo (la fuente de los valores es schema.ts).

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  cumple_no_aplica: 'Cumple / No aplica',
  si_no: 'Sí / No',
  texto: 'Texto libre',
  numerico: 'Numérico',
};

export const TIPO_INSPECCION_LABELS: Record<TipoInspeccion, string> = {
  rgrl_463_09: 'RGRL (Res. SRT 463/09)',
  generico: 'Genérico',
};

/** Label legible del estado de una versión ('draft' | 'published' | 'archived'). */
export function estadoLabel(estado: string | null): string {
  switch (estado) {
    case 'draft':
      return 'Borrador';
    case 'published':
      return 'Publicada';
    case 'archived':
      return 'Archivada';
    default:
      return '—';
  }
}
