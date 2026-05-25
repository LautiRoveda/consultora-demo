import type { EmpleadoRow } from './queries';

export { formatDni } from '@/shared/templates/common/dni';
export {
  formatCivilDateShortAR as formatCivilDateEs,
  formatDateShortAR as formatDateEs,
} from '@/shared/lib/format-date';

export function isArchived(empleado: Pick<EmpleadoRow, 'archived_at'>): boolean {
  return empleado.archived_at !== null;
}
