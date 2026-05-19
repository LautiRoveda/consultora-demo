import type { EmpleadoRow } from './queries';
import Link from 'next/link';

import { Badge } from '@/shared/ui/badge';

import { formatDateEs, formatDni, isArchived } from './labels';

/**
 * Densidad fija: placeholders `'—'` en cada slot vacío (matchea pattern T-049
 * `ClienteListCard`). Header: apellido, nombre. Subline: DNI · puesto. Tercera
 * línea: fecha de ingreso.
 */
export function EmpleadoListCard({ empleado }: { empleado: EmpleadoRow }) {
  const dniDisplay = formatDni(empleado.dni);
  const puesto = empleado.puesto ?? '—';
  const fechaIngreso = empleado.fecha_ingreso ? formatDateEs(empleado.fecha_ingreso) : '—';

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
          <p className="text-muted-foreground text-sm">
            DNI {dniDisplay} · {puesto}
          </p>
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
