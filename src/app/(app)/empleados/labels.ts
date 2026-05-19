import type { EmpleadoRow } from './queries';

export { formatDni } from '@/shared/templates/common/dni';

export function formatDateEs(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function isArchived(empleado: Pick<EmpleadoRow, 'archived_at'>): boolean {
  return empleado.archived_at !== null;
}
