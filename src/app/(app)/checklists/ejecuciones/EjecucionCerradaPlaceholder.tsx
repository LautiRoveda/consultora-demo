import type { ChecklistExecutionRow } from './queries';
import Link from 'next/link';

import { formatCivilDateAR } from '@/shared/lib/format-date';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { EjecucionEstadoBadge } from './EjecucionEstadoBadge';

/**
 * T-061a · Vista mínima read-only para inspecciones cerradas/anuladas. El detalle
 * completo (hallazgos, CAPAs, firma, Descargar PDF, anular) lo trae T-061b — esto
 * solo evita que el link del listado caiga en un 404 mientras tanto.
 */
export function EjecucionCerradaPlaceholder({ execution }: { execution: ChecklistExecutionRow }) {
  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/checklists/ejecuciones">← Inspecciones</Link>
        </Button>
        <EjecucionEstadoBadge estado={execution.estado} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{execution.establecimiento_razon_social ?? 'Inspección'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {execution.fecha_inspeccion && (
            <p className="text-muted-foreground">
              Inspección del {formatCivilDateAR(execution.fecha_inspeccion)}
            </p>
          )}
          {execution.cumplimiento_pct != null && (
            <p>
              Cumplimiento: <span className="font-medium">{execution.cumplimiento_pct}%</span>
            </p>
          )}
          {execution.tiene_criticos_incumplidos && (
            <p className="text-destructive">Tiene ítems críticos incumplidos.</p>
          )}
          <p className="text-muted-foreground">
            El detalle completo (hallazgos, acciones correctivas, firma y descarga del PDF) llega en
            la próxima entrega.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
