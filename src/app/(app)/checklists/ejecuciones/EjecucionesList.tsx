import type { ChecklistExecutionVigenteRow } from './queries';
import Link from 'next/link';

import { formatCivilDateAR, formatDateAR } from '@/shared/lib/format-date';
import { Card, CardContent } from '@/shared/ui/card';

import { EjecucionEstadoBadge } from './EjecucionEstadoBadge';

export type EjecucionesListProps = {
  ejecuciones: ChecklistExecutionVigenteRow[];
  /** cliente_id → razón social, para mostrar el cliente en borradores (aún sin snapshot). */
  clienteNameById: Record<string, string>;
};

function clienteLabel(
  row: ChecklistExecutionVigenteRow,
  clienteNameById: Record<string, string>,
): string {
  // Cerrada: el snapshot del establecimiento está congelado en la fila.
  // Borrador: todavía no hay snapshot → resolvemos por cliente_id.
  if (row.establecimiento_razon_social) return row.establecimiento_razon_social;
  if (row.cliente_id) {
    const name = clienteNameById[row.cliente_id];
    if (name) return name;
  }
  return 'Cliente sin nombre';
}

export function EjecucionesList({ ejecuciones, clienteNameById }: EjecucionesListProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {ejecuciones.map((row) => {
        if (!row.id) return null; // la vista tipa id nullable; en la práctica nunca lo es.
        const estado = row.estado ?? 'borrador';
        const esBorrador = estado === 'borrador';
        const subtitle =
          estado === 'cerrada'
            ? 'Inspección cerrada'
            : estado === 'anulada'
              ? 'Inspección anulada'
              : 'Borrador en curso';
        const fecha = row.fecha_inspeccion
          ? formatCivilDateAR(row.fecha_inspeccion)
          : row.created_at
            ? formatDateAR(row.created_at)
            : '—';
        const pct =
          estado === 'cerrada' && row.cumplimiento_pct != null ? `${row.cumplimiento_pct}%` : null;
        const label = clienteLabel(row, clienteNameById);
        // El head de una cadena anulada es el TOMBSTONE (sin respuestas/firma): linkeamos
        // al original (corrige_id), cuyo detalle renderiza todo + banner "anulada" (T-061b).
        const targetId = estado === 'anulada' && row.corrige_id ? row.corrige_id : row.id;

        return (
          <Link
            key={row.id}
            href={`/checklists/ejecuciones/${targetId}`}
            className="focus-visible:ring-ring block rounded-lg outline-none focus-visible:ring-2"
            aria-label={`${esBorrador ? 'Continuar' : 'Ver'} inspección de ${label}`}
          >
            <Card className="hover:bg-muted/30 transition-colors">
              <CardContent className="grid gap-2 pt-6">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{label}</div>
                    <div className="text-muted-foreground text-sm">{subtitle}</div>
                  </div>
                  <EjecucionEstadoBadge estado={estado} />
                </div>
                <div className="text-muted-foreground flex items-center justify-between text-xs">
                  <span>Inspección del {fecha}</span>
                  {pct != null && (
                    <span className={row.tiene_criticos_incumplidos ? 'text-destructive' : ''}>
                      Cumplimiento {pct}
                    </span>
                  )}
                  {esBorrador && <span aria-hidden="true">Continuar →</span>}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
