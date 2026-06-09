import type { EmpleadoRow } from './queries';
import Link from 'next/link';

import { Badge } from '@/shared/ui/badge';

import { formatCivilDateEs, formatDateEs, formatDni, isArchived } from './labels';

/**
 * Densidad fija: placeholders `'—'` en cada slot vacío (matchea pattern T-049
 * `ClienteListCard`). Header: apellido, nombre. Subline: DNI. Tercera línea:
 * fecha de ingreso. (T-129: el puesto se sacó del subline — vive en el catálogo,
 * visible en el detalle; la lista desambigua por nombre + DNI.)
 */
export function EmpleadoListCard({ empleado }: { empleado: EmpleadoRow }) {
  const dniDisplay = formatDni(empleado.dni);
  const fechaIngreso = empleado.fecha_ingreso ? formatCivilDateEs(empleado.fecha_ingreso) : '—';

  return (
    <Link
      href={`/empleados/${empleado.id}`}
      className="hover:bg-accent block rounded-lg border p-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-foreground font-medium">
            {empleado.apellido}, {empleado.nombre}
          </p>
          <p className="text-muted-foreground text-sm">DNI {dniDisplay}</p>
          <p className="text-muted-foreground text-xs">Ingreso: {fechaIngreso}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {isArchived(empleado) && <Badge variant="secondary">Archivado</Badge>}
          <time className="text-muted-foreground text-xs" dateTime={empleado.created_at}>
            {formatDateEs(empleado.created_at)}
          </time>
        </div>
      </div>
    </Link>
  );
}
