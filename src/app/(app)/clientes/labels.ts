import type { ClienteRow } from './queries';

import { PROVINCIAS_AR } from '@/shared/templates/common/site';

const PROVINCIA_LOOKUP: Record<string, string> = Object.fromEntries(
  PROVINCIAS_AR.map((p) => [p.code, p.name]),
);

// Lookup defensivo: SQL permite text libre en `provincia`, fallback al raw code
// si no matchea ningún PROVINCIAS_AR.code (rows pre-T-049 o futureproofing CL/UY).
// PROVINCIA_NAME_BY_CODE de common/site.ts es privado — replicamos el lookup acá.
export function provinciaLabel(code: string | null): string | null {
  if (!code) return null;
  return PROVINCIA_LOOKUP[code] ?? code;
}

export function formatDateEs(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function isArchived(cliente: Pick<ClienteRow, 'archived_at'>): boolean {
  return cliente.archived_at !== null;
}
